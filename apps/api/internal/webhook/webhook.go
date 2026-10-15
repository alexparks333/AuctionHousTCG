// Package webhook is the single entry point for asynchronous events Stripe
// sends us — the one piece of payment-state sync in this app that isn't
// driven by a synchronous request handler. No webhook handler existed
// before this (design doc v2 §5.2): every event type below maps directly to
// a transition described in the design doc, and every event is deduplicated
// against the stripe_events table before any side effect runs, since Stripe
// redelivers on anything other than a 200 response.
//
// One-time dashboard setup this package's code can't do for you: by
// default a webhook endpoint only receives PLATFORM-level events.
// account.updated/payout.paid/payout.failed all fire on a connected
// account, not the platform account, so this endpoint must be explicitly
// configured to also receive Connect events — the "Listen to events on
// Connected accounts" toggle when creating the endpoint in the Stripe
// Dashboard (dashboard.stripe.com/test/webhooks), or `connect: true` if
// creating it via the API. Without that, this handler is registered and
// signature-verifies fine, it just never gets called for those event types.
//
// charge.dispute.created/updated/closed are the one platform-level event
// family here that isn't a state-machine transition for an order this repo
// already models — a real cardholder chargeback (internal/chargeback) is
// tracked separately from internal/dispute's buyer-initiated claims, since
// it can happen on any order at any point in its life, independent of
// whether a claim was ever filed.
package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"

	"auctionhous-tcg/api/internal/accountban"
	"auctionhous-tcg/api/internal/chargeback"
	"auctionhous-tcg/api/internal/mail"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/seller"
)

// alreadyProcessed upserts eventID into stripe_events; a true return means
// this event was already handled and its side effects must not run again.
// Standard Stripe-recommended idempotency pattern (design doc v2 §5.2) —
// Stripe redelivers any event that didn't get a 200 response.
func alreadyProcessed(ctx context.Context, pool *pgxpool.Pool, eventID, eventType string) (bool, error) {
	tag, err := pool.Exec(ctx, `
		insert into stripe_events (id, type) values ($1, $2)
		on conflict (id) do nothing`, eventID, eventType)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 0, nil
}

// HandleStripe verifies and dispatches incoming Stripe webhook events. Must
// be registered OUTSIDE the Supabase-JWT auth chain — Stripe authenticates
// its own requests via the Stripe-Signature header, verified against
// webhookSecret, not a bearer token. mailClient/webOrigin are only used by
// the charge.dispute.created case (internal/chargeback.RecordCreated);
// identityHMACKey is only used by identity.verification_session.verified
// (recordIdentityVerified's ban-evasion cross-check) — every other event
// type here doesn't need any of these.
func HandleStripe(pool *pgxpool.Pool, webhookSecret string, mailClient *mail.Client, webOrigin, identityHMACKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read body", http.StatusBadRequest)
			return
		}

		// IgnoreAPIVersionMismatch: stripe-go v82.5.1 is pinned to API
		// version 2025-08-27.basil, but this Stripe account's own default
		// (set on account creation, not something this repo controls) is
		// newer — the SDK's webhook verifier refuses to parse an event
		// declaring a version it doesn't recognize as a safety check, even
		// though the signature itself is valid. Every field this handler
		// actually reads below (account.id/charges_enabled/payouts_enabled/
		// details_submitted, payout.id/status, payment_intent.id) has been
		// stable across Stripe API versions for years, so the "objects may
		// be incorrectly deserialized" risk the SDK warns about is low for
		// what's used here. The durable fix is pinning the SDK to a newer
		// release (or the webhook endpoint to an older API version) —
		// flagged as real follow-up, not attempted mid-session.
		event, err := webhook.ConstructEventWithOptions(payload, r.Header.Get("Stripe-Signature"), webhookSecret, webhook.ConstructEventOptions{
			IgnoreAPIVersionMismatch: true,
		})
		if err != nil {
			log.Printf("webhook: signature verification failed: %v", err)
			http.Error(w, "invalid signature", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		dup, err := alreadyProcessed(ctx, pool, event.ID, string(event.Type))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if dup {
			w.WriteHeader(http.StatusOK)
			return
		}

		if err := dispatch(ctx, pool, mailClient, webOrigin, identityHMACKey, event); err != nil {
			log.Printf("webhook: handling %s (%s) failed: %v", event.ID, event.Type, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

func dispatch(ctx context.Context, pool *pgxpool.Pool, mailClient *mail.Client, webOrigin, identityHMACKey string, event stripe.Event) error {
	switch event.Type {
	case "charge.dispute.created":
		var d stripe.Dispute
		if err := json.Unmarshal(event.Data.Raw, &d); err != nil {
			return err
		}
		return chargeback.RecordCreated(ctx, pool, mailClient, webOrigin, &d)
	case "charge.dispute.updated", "charge.dispute.closed":
		var d stripe.Dispute
		if err := json.Unmarshal(event.Data.Raw, &d); err != nil {
			return err
		}
		return chargeback.RecordStatusChange(ctx, pool, &d)
	case "account.updated":
		var acct stripe.Account
		if err := json.Unmarshal(event.Data.Raw, &acct); err != nil {
			return err
		}
		return seller.SyncConnectAccountFromWebhook(ctx, pool, &acct)
	case "payout.paid", "payout.failed":
		var p stripe.Payout
		if err := json.Unmarshal(event.Data.Raw, &p); err != nil {
			return err
		}
		return syncPayoutStatus(ctx, pool, &p, event.Type)
	case "payment_intent.succeeded":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			return err
		}
		return advancePaymentPendingOrder(ctx, pool, pi.ID)
	case "payment_intent.payment_failed":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			return err
		}
		return cancelPaymentPendingOrder(ctx, pool, pi.ID)
	case "identity.verification_session.verified":
		var vs stripe.IdentityVerificationSession
		if err := json.Unmarshal(event.Data.Raw, &vs); err != nil {
			return err
		}
		return recordIdentityVerified(ctx, pool, &vs, identityHMACKey)
	case "setup_intent.succeeded":
		var si stripe.SetupIntent
		if err := json.Unmarshal(event.Data.Raw, &si); err != nil {
			return err
		}
		return recordBankVerified(ctx, pool, &si)
	default:
		// Not every event type Stripe can send is one we act on — silently
		// acknowledging (200) an event type we don't handle is correct;
		// only a genuine processing failure for a type we DO handle
		// should trigger a Stripe redelivery.
		return nil
	}
}

// advancePaymentPendingOrder handles the ACH rail's async confirmation
// (design doc v2 §5.2, §4): the card rail already lands in awaiting_ship
// synchronously in internal/auction/buynow.go, so this webhook firing for
// a card order is a harmless no-op (its order is already past
// payment_pending) — only an order genuinely still sitting in
// payment_pending (an ACH order whose 4-business-day confirmation just
// completed) actually advances here.
func advancePaymentPendingOrder(ctx context.Context, pool *pgxpool.Pool, paymentIntentID string) error {
	o, err := order.GetByPaymentIntentID(ctx, pool, paymentIntentID)
	if err != nil {
		if errors.Is(err, order.ErrNotFound) {
			return nil
		}
		return err
	}
	if o.State != order.StatePaymentPending {
		return nil
	}
	if err := order.Transition(ctx, pool, o.ID, order.StatePaymentPending, order.StatePaid); err != nil {
		return err
	}

	// paid_at on listings/auctions was deliberately left unset for the ACH
	// rail when the order was created (internal/auction/buynow.go) — this
	// is the moment it actually becomes true. o.ListingID's row exists in
	// exactly one of these two tables depending on format; running both
	// updates unconditionally is simpler than fetching the listing first to
	// find out which, and the one that doesn't apply just affects 0 rows.
	if _, err := pool.Exec(ctx, `update listings set paid_at = now() where id = $1`, o.ListingID); err != nil {
		return fmt.Errorf("record listing paid_at: %w", err)
	}
	if _, err := pool.Exec(ctx, `update auctions set paid_at = now() where listing_id = $1`, o.ListingID); err != nil {
		return fmt.Errorf("record auction paid_at: %w", err)
	}
	// Add-on listings bundled onto this order at checkout (order_addons)
	// became paid at the same moment as the primary listing.
	if _, err := pool.Exec(ctx, `
		update listings set paid_at = now()
		where id in (select listing_id from order_addons where order_id = $1 and listing_id is not null and voided_at is null)
			and paid_at is null
	`, o.ID); err != nil {
		return fmt.Errorf("record add-on listing paid_at: %w", err)
	}

	return order.Transition(ctx, pool, o.ID, order.StatePaid, order.StateAwaitingShip)
}

// cancelPaymentPendingOrder handles an ACH charge that ultimately failed or
// was returned by the buyer's bank (design doc v2 §5.2's
// "charge.failed -> cancelled" edge) — only acts on an order still
// genuinely in payment_pending, same reasoning as advancePaymentPendingOrder.
//
// Known gap, flagged rather than silently assumed away: this does not
// reverse the listing/auction ownership the atomic compare-and-swap already
// granted before the ACH intent was confirmed (internal/auction.BuyNow /
// listing.BuyNowFixed) — the order correctly reflects "cancelled, unpaid,"
// but the item itself stays marked sold/ended rather than returning to
// active. Reopening a listing after a days-later payment failure is a real
// product decision (relist automatically? notify the seller to relist
// manually? does the second-highest bidder get first refusal?) that design
// doc v2 doesn't specify — not resolved here.
func cancelPaymentPendingOrder(ctx context.Context, pool *pgxpool.Pool, paymentIntentID string) error {
	o, err := order.GetByPaymentIntentID(ctx, pool, paymentIntentID)
	if err != nil {
		if errors.Is(err, order.ErrNotFound) {
			return nil
		}
		return err
	}
	if o.State != order.StatePaymentPending {
		return nil
	}
	if err := order.Transition(ctx, pool, o.ID, order.StatePaymentPending, order.StateCancelled); err != nil {
		return err
	}
	// Unlike the primary listing (see the known gap above), Singles Shop
	// stock has no relisting question — the copies are simply back on hand.
	return order.ReleaseAddons(ctx, pool, o.ID)
}

// syncPayoutStatus updates our own payouts row from Stripe's actual
// outcome — internal/payout.BatchReleasedOrders only ever sets status to
// 'in_transit' when it creates the Payout; whether it actually lands in
// the seller's bank ('paid') or bounces ('failed') is only known
// asynchronously, via this webhook (design doc v2 §6).
func syncPayoutStatus(ctx context.Context, pool *pgxpool.Pool, p *stripe.Payout, eventType stripe.EventType) error {
	status := "paid"
	if eventType == "payout.failed" {
		status = "failed"
	}
	_, err := pool.Exec(ctx, `
		update payouts set status = $1, paid_at = case when $1 = 'paid' then now() else paid_at end
		where stripe_payout_id = $2
	`, status, p.ID)
	return err
}

// recordIdentityVerified is KYC level 2's only write path — never set
// directly by any request handler, only by Stripe's own confirmation that
// the document + ID-number check actually passed (internal/identity only
// ever creates the session and hands back its hosted-flow URL). Matched on
// BOTH the user id (ClientReferenceID, stamped at session-creation time)
// and the session id itself, so a stale/superseded session belonging to
// that user can never retroactively verify them after a newer session was
// started.
//
// Also computes and stores identityFingerprint (below) and cross-checks it
// against every other user — a real gap this closes: KYC as originally
// built proved "this is a real, distinct-feeling account," not "this isn't
// the same person who was already banned." A banned user going through a
// brand-new Stripe Identity session with their own real government ID
// produces the exact same fingerprint as their banned account did, which
// is what this catches.
func recordIdentityVerified(ctx context.Context, pool *pgxpool.Pool, vs *stripe.IdentityVerificationSession, identityHMACKey string) error {
	if vs.ClientReferenceID == "" {
		log.Printf("webhook: identity verification session %s has no client_reference_id — cannot resolve user", vs.ID)
		return nil
	}
	if _, err := pool.Exec(ctx, `
		update users set identity_verified_at = now()
		where id = $1 and stripe_identity_session_id = $2
	`, vs.ClientReferenceID, vs.ID); err != nil {
		return err
	}

	fingerprint := identityFingerprint(identityHMACKey, vs.VerifiedOutputs)
	if fingerprint == "" {
		// No IDENTITY_FINGERPRINT_HMAC_KEY configured, or Stripe didn't
		// return verified_outputs on this event — same graceful-degradation
		// shape as every other optional check in this codebase: identity
		// verification itself still succeeded above, this is an additional
		// layer on top of it, not a requirement for KYC level 2 itself.
		return nil
	}
	if _, err := pool.Exec(ctx, `
		update users set identity_fingerprint_hash = $1 where id = $2
	`, fingerprint, vs.ClientReferenceID); err != nil {
		log.Printf("webhook: failed to store identity fingerprint for %s: %v", vs.ClientReferenceID, err)
		return nil
	}

	var matchesBannedAccount bool
	if err := pool.QueryRow(ctx, `
		select exists(
			select 1 from users u
			join account_suspensions s on s.user_id = u.id
			where u.identity_fingerprint_hash = $1 and u.id != $2 and now() < s.ends_at
		)
	`, fingerprint, vs.ClientReferenceID).Scan(&matchesBannedAccount); err != nil {
		log.Printf("webhook: failed to check identity fingerprint reuse for %s: %v", vs.ClientReferenceID, err)
		return nil
	}
	if matchesBannedAccount {
		banned, err := accountban.Ban(ctx, pool, vs.ClientReferenceID, accountban.ReasonBanEvasion)
		if err != nil {
			log.Printf("webhook: failed to ban %s for identity-fingerprint reuse: %v", vs.ClientReferenceID, err)
		} else if banned {
			log.Printf("webhook: banned user %s — identity fingerprint matches an already-banned account", vs.ClientReferenceID)
		}
	}
	return nil
}

// identityFingerprint derives a one-way, non-reversible fingerprint from
// Stripe Identity's own verified ID number + date of birth — never the raw
// SSN or ID document, which never touches this column or any other. HMAC,
// not a plain hash: an SSN is only 9 digits (at most ~1 billion
// combinations), low enough entropy that a plain SHA-256 of one is
// brute-forceable offline in seconds from a leaked table — HMAC with a
// server-side-only secret key (identityHMACKey, IDENTITY_FINGERPRINT_HMAC_KEY)
// makes that infeasible without also having the key. Deterministic (same
// person always produces the same fingerprint) is exactly the point — it's
// what makes cross-account comparison possible at all — so this key must
// never rotate casually: rotating it silently stops matching any
// previously-stored fingerprint against new ones.
func identityFingerprint(hmacKey string, vo *stripe.IdentityVerificationSessionVerifiedOutputs) string {
	if hmacKey == "" || vo == nil || vo.IDNumber == "" || vo.DOB == nil {
		return ""
	}
	normalized := strings.ToUpper(strings.TrimSpace(vo.IDNumber)) + "|" +
		fmt.Sprintf("%04d-%02d-%02d", vo.DOB.Year, vo.DOB.Month, vo.DOB.Day)
	mac := hmac.New(sha256.New, []byte(hmacKey))
	mac.Write([]byte(normalized))
	return hex.EncodeToString(mac.Sum(nil))
}

// recordBankVerified is KYC level 3's only write path — a us_bank_account
// SetupIntent only ever reaches 'succeeded' after Stripe has actually
// verified the account (instantly via Financial Connections, or the buyer
// confirming two micro-deposit amounts days later), so this event firing
// at all IS the verification, not a separate check on top of it. Resolved
// back to our own user via stripe_customer_id (internal/paymentmethod's
// existingCustomerID/CreateBankSetupIntentSecret already stamp this column
// when a saved card/bank is first created) — a SetupIntent has no
// client_reference_id field the way IdentityVerificationSession does.
// Every OTHER setup_intent.succeeded event (the card rail uses the same
// event type) is a silent no-op here, not an error — only a
// us_bank_account one should ever advance KYC.
func recordBankVerified(ctx context.Context, pool *pgxpool.Pool, si *stripe.SetupIntent) error {
	isBank := false
	for _, t := range si.PaymentMethodTypes {
		if t == "us_bank_account" {
			isBank = true
			break
		}
	}
	if !isBank || si.Customer == nil || si.Customer.ID == "" {
		return nil
	}
	_, err := pool.Exec(ctx, `
		update users set bank_verified_at = now()
		where stripe_customer_id = $1 and bank_verified_at is null
	`, si.Customer.ID)
	return err
}
