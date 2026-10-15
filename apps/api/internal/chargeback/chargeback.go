// Package chargeback tracks real Stripe disputes (charge.dispute.* webhook
// events) — a cardholder going straight to their card issuer, as opposed to
// a buyer opening a claim through internal/dispute inside our own UI. The
// two are deliberately not the same table or state machine: a chargeback
// can land on an order that never had a claim filed at all, at any point in
// that order's life (even long after it's released), and money movement is
// entirely Stripe's own doing the instant the dispute is created — this
// package's job is to record what happened, stop the platform from paying a
// seller out for a charge Stripe has already reversed, and put a human on
// notice, never to move money itself.
package chargeback

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"

	"auctionhous-tcg/api/internal/mail"
	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/secondchance"
)

// Status mirrors stripe.DisputeStatus verbatim, not a parallel enum —
// migration 0034's check constraint lists the same eight values.
type Status string

const (
	StatusWarningNeedsResponse Status = "warning_needs_response"
	StatusWarningUnderReview   Status = "warning_under_review"
	StatusWarningClosed        Status = "warning_closed"
	StatusNeedsResponse        Status = "needs_response"
	StatusUnderReview          Status = "under_review"
	StatusWon                  Status = "won"
	StatusLost                 Status = "lost"
	StatusPrevented            Status = "prevented"
)

// blocksRelease is every status where the disputed amount either hasn't
// been decided yet or has already been decided against the platform —
// order.ReleaseFunds checks this before ever calling Transfer, so a seller
// is never paid out for a charge that's mid-dispute or already reversed.
// Only won/warning_closed/prevented — dispute resolved in the platform's
// favor, or Stripe closed it without ever actually debiting anything —
// clear the block.
var blocksRelease = map[Status]bool{
	StatusWarningNeedsResponse: true,
	StatusWarningUnderReview:   true,
	StatusNeedsResponse:        true,
	StatusUnderReview:          true,
	StatusLost:                 true,
	StatusWon:                  false,
	StatusWarningClosed:        false,
	StatusPrevented:            false,
}

// lookupOrder resolves the order a Stripe Dispute is against. Prefers the
// PaymentIntent (what every other webhook handler in this repo keys off of
// — internal/webhook.go's payment_intent.* cases), falls back to the Charge
// itself since a Dispute always has one even when PaymentIntent isn't
// populated on a given API version/event payload.
func lookupOrder(ctx context.Context, pool *pgxpool.Pool, d *stripe.Dispute) (*order.Order, error) {
	if d.PaymentIntent != nil && d.PaymentIntent.ID != "" {
		o, err := order.GetByPaymentIntentID(ctx, pool, d.PaymentIntent.ID)
		if err == nil {
			return o, nil
		}
		if !errors.Is(err, order.ErrNotFound) {
			return nil, err
		}
	}
	if d.Charge != nil && d.Charge.ID != "" {
		return order.GetByChargeID(ctx, pool, d.Charge.ID)
	}
	return nil, order.ErrNotFound
}

// RecordCreated handles charge.dispute.created: inserts the chargeback row
// (idempotent on stripe_dispute_id, since Stripe can redeliver) and, if the
// order hadn't already released funds to the seller, alerts a human
// immediately — unlike internal/dispute's claims, there is no automated
// resolution path here at all; every real chargeback needs a person, since
// the platform's own balance is what's actually on the line.
func RecordCreated(ctx context.Context, pool *pgxpool.Pool, mailClient *mail.Client, webOrigin string, d *stripe.Dispute) error {
	o, err := lookupOrder(ctx, pool, d)
	if err != nil {
		if errors.Is(err, order.ErrNotFound) {
			log.Printf("chargeback: dispute %s has no matching order — payment_intent=%v charge=%v", d.ID, disputePaymentIntentID(d), disputeChargeID(d))
			return nil
		}
		return err
	}

	releasedAlready := o.State == order.StateReleased
	tag, err := pool.Exec(ctx, `
		insert into chargebacks (order_id, stripe_dispute_id, status, reason, amount_cents, order_was_released_at_creation)
		values ($1, $2, $3, $4, $5, $6)
		on conflict (stripe_dispute_id) do nothing
	`, o.ID, d.ID, string(d.Status), string(d.Reason), d.Amount, releasedAlready)
	if err != nil {
		return fmt.Errorf("insert chargeback: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Already recorded — a Stripe redelivery, not a new dispute.
		return nil
	}

	banBuyer(ctx, pool, o)
	notify(ctx, mailClient, webOrigin, o, d, releasedAlready)
	return nil
}

// banBuyer is the actual "any chargeback filed at all is a bannable
// offense" trigger — confirmed product decision: not "lost," not
// "delivered," the violation is going around the claims system to the
// bank in the first place, which is inherently ambiguous from the
// marketplace's side (empty box? wrong card? genuine fraud?) and exactly
// what internal/dispute's claims system exists to adjudicate instead.
// Fires here, unconditionally, on every genuinely new dispute — completely
// independent of RecordStatusChange/handleLostChargeback below, which
// keeps doing its own separate order-state/second-chance job untouched.
// Permanent (ends_at = 'infinity', not a 7-day window like the
// ship-deadline suspension) and idempotent per user — a buyer who somehow
// racks up more than one dispute doesn't get a second, redundant ban row.
// Best-effort/logged, not returned: the chargeback row itself is already
// durably recorded by the time this runs, and a failure here must never
// make Stripe retry the whole webhook delivery.
func banBuyer(ctx context.Context, pool *pgxpool.Pool, o *order.Order) {
	tag, err := pool.Exec(ctx, `
		insert into account_suspensions (user_id, reason, ends_at)
		select $1, 'chargeback_fraud', 'infinity'
		where not exists (
			select 1 from account_suspensions where user_id = $1 and reason = 'chargeback_fraud'
		)
	`, o.BuyerID)
	if err != nil {
		log.Printf("chargeback: failed to record ban for buyer %s (order %s): %v", o.BuyerID, o.ID, err)
		return
	}
	if tag.RowsAffected() == 0 {
		// Already banned from an earlier dispute — nothing new to notify.
		return
	}
	if err := notification.Create(ctx, pool, o.BuyerID, notification.KindAccountBanned, o.ListingID); err != nil {
		log.Printf("chargeback: failed to notify banned buyer %s: %v", o.BuyerID, err)
	}
}

// preShipStates is every order state a chargeback could land on where the
// item genuinely hasn't shipped yet — the buyer-fault failure case
// internal/secondchance exists for (see HandleLostChargeback below).
// created/payment_pending aren't included: a chargeback requires a real
// Stripe charge to dispute, which doesn't exist yet for an order still in
// either of those two states (FinalizePayment is what records
// stripe_charge_id), so lookupOrder could never actually resolve one there
// in practice — listed here anyway for a state machine that's explicit
// about every case rather than one relying on that being true forever.
var preShipStates = map[order.State]bool{
	order.StateCreated:        true,
	order.StatePaymentPending: true,
	order.StatePaid:           true,
	order.StateAwaitingShip:   true,
}

// RecordStatusChange handles charge.dispute.updated/charge.dispute.closed —
// Stripe sends both as the dispute's evidence/status changes over its
// lifecycle; either way this just brings our copy of the status current.
// A dispute this package has never seen created (shouldn't happen —
// Stripe always sends charge.dispute.created first — but webhook delivery
// order isn't guaranteed) is a silent no-op rather than an error, same
// "don't fail the webhook over a redelivery-ordering edge case" reasoning
// as internal/webhook's own dedup handling.
//
// On a status of lost specifically, this now also reflects the loss into
// the order's own state — previously it never did, so an order could sit
// in released (or anywhere else) forever after a lost dispute, with the
// only record of what happened being the chargebacks row itself and one
// email to platform ops. Pre-ship, this is exactly the same buyer-fault
// failure internal/secondchance handles for never-paid orders (the seller
// still has the item, still worth re-offering to the runner-up); once
// shipped, the item is essentially always already with the buyer, so
// there's nothing to resell — just a fact to record and a seller to
// notify they won't be paid for this one.
func RecordStatusChange(ctx context.Context, pool *pgxpool.Pool, d *stripe.Dispute) error {
	var orderID string
	if _, err := pool.Exec(ctx, `
		update chargebacks set status = $1, updated_at = now() where stripe_dispute_id = $2
	`, string(d.Status), d.ID); err != nil {
		return fmt.Errorf("update chargeback status: %w", err)
	}
	if err := pool.QueryRow(ctx, `
		select order_id from chargebacks where stripe_dispute_id = $1
	`, d.ID).Scan(&orderID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("look up chargeback's order: %w", err)
	}

	if Status(d.Status) != StatusLost {
		return nil
	}
	handleLostChargeback(ctx, pool, orderID)
	return nil
}

// handleLostChargeback does the actual reflection described above —
// best-effort and logged, not returned, since by this point the webhook
// itself has already durably recorded the chargeback row; a failure here
// must never make Stripe retry the whole webhook delivery.
// order.Transition's own compare-and-swap is what makes this safe against
// racing a claim resolution or the claim-window release timer landing on
// the same order at nearly the same moment — a failed CAS here is exactly
// that race, logged and skipped, not an error.
func handleLostChargeback(ctx context.Context, pool *pgxpool.Pool, orderID string) {
	o, err := order.GetByID(ctx, pool, orderID)
	if err != nil {
		log.Printf("chargeback: failed to read order %s for lost dispute: %v", orderID, err)
		return
	}

	if err := order.Transition(ctx, pool, orderID, o.State, order.StateRefunded); err != nil {
		log.Printf("chargeback: failed to transition order %s to refunded: %v", orderID, err)
		return
	}

	if preShipStates[o.State] {
		secondchance.HandleBuyerFault(ctx, pool, o.ListingID, o.SellerID, o.BuyerID)
		return
	}
	if err := notification.Create(ctx, pool, o.SellerID, notification.KindChargebackLost, o.ListingID); err != nil {
		log.Printf("chargeback: failed to notify seller for order %s: %v", orderID, err)
	}
}

// HasBlockingChargeback reports whether orderID has any chargeback still
// pending or already lost — order.ReleaseFunds calls this immediately
// before every Transfer attempt (both the claim-window-elapsed path and
// every dispute-resolution path that pays the seller) so a chargeback that
// arrived mid-claim-window, mid-negotiation, or even after a claim resolved
// in the seller's favor still stops the payout.
func HasBlockingChargeback(ctx context.Context, pool *pgxpool.Pool, orderID string) (bool, error) {
	rows, err := pool.Query(ctx, `select status from chargebacks where order_id = $1`, orderID)
	if err != nil {
		return false, fmt.Errorf("query chargebacks: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			return false, fmt.Errorf("scan chargeback status: %w", err)
		}
		if blocksRelease[Status(status)] {
			return true, nil
		}
	}
	return false, rows.Err()
}

// notify sends the one email this package ever sends — every chargeback
// needs a person's eyes, so unlike internal/dispute's notifyHumanReview
// (which only fires for the subset of claims auto-adjudication couldn't
// resolve), this fires unconditionally on every genuinely new dispute.
// Best-effort: a failed send is logged, never returned, since the
// chargeback row itself is already recorded and that's the fact that
// actually matters.
func notify(ctx context.Context, mailClient *mail.Client, webOrigin string, o *order.Order, d *stripe.Dispute, releasedAlready bool) {
	if !mailClient.IsConfigured() {
		return
	}
	risk := "Funds for this order have NOT been transferred to the seller yet — the payout will be held automatically."
	if releasedAlready {
		risk = "This order was ALREADY released and transferred to the seller — this dispute is a direct loss against the platform's own Stripe balance unless won."
	}
	subject := fmt.Sprintf("Chargeback filed — order %s (%s)", o.ID, string(d.Reason))
	html := fmt.Sprintf(`
		<p><strong>A real Stripe dispute was filed</strong> against order %s.</p>
		<ul>
			<li><strong>Reason:</strong> %s</li>
			<li><strong>Amount:</strong> $%.2f</li>
			<li><strong>Order state at time of dispute:</strong> %s</li>
		</ul>
		<p>%s</p>
		<p>Respond to this dispute directly in the <a href="https://dashboard.stripe.com/disputes/%s">Stripe Dashboard</a> — there is no in-app review flow for chargebacks yet.</p>
	`, o.ID, string(d.Reason), float64(d.Amount)/100, string(o.State), risk, d.ID)
	if err := mailClient.Send(ctx, subject, html); err != nil {
		log.Printf("chargeback: failed to send notification for dispute %s: %v", d.ID, err)
	}
	_ = webOrigin // reserved for a future admin-surface deep link, once one exists (see docs/BuyerSellerGuarantee.md §6.2)
}

func disputePaymentIntentID(d *stripe.Dispute) string {
	if d.PaymentIntent == nil {
		return ""
	}
	return d.PaymentIntent.ID
}

func disputeChargeID(d *stripe.Dispute) string {
	if d.Charge == nil {
		return ""
	}
	return d.Charge.ID
}
