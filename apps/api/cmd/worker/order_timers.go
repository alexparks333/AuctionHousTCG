package main

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/chargeback"
	"auctionhous-tcg/api/internal/dispute"
	"auctionhous-tcg/api/internal/mail"
	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/secondchance"
	"auctionhous-tcg/api/internal/shipping"
)

// letterShipmentAssumedDeliveryDays is how long a tracked_envelope/
// free_envelope order sits in "shipped" before this worker assumes it
// arrived. Pitney Bowes' IMb tracking (internal/shipping's package doc)
// only proves the mailpiece entered USPS's system — it structurally never
// produces a delivery scan the way a Shippo package does, so
// refundUndeliveredOrders' 21-day no-scan-means-refund rule would
// incorrectly refund every single envelope shipment a few weeks in.
// First-Class Mail typically delivers within a few business days; 7
// calendar days is a deliberately generous buffer before assuming
// delivery, matching the original PWE concept's timer from before this
// feature existed.
const letterShipmentAssumedDeliveryDays = 7

// unpaidOrderWindowHours mirrors the web app's own PAYMENT_WINDOW_MS
// (apps/web/lib/types.ts) — the 24h a buyer has to pay for a won auction
// before cancelUnpaidOrders gives up and cancels it.
const unpaidOrderWindowHours = 24

// undeliveredClaimBackstopDays is how long a shipped, package-mechanism
// order can sit with zero delivery scan and no claim filed before this
// worker files one itself (escalateUndeliveredOrders) — not an automatic
// refund (a buyer could be lying about never receiving it just as easily
// as a seller could be lying about having shipped it at all), so this is a
// backstop against the case rotting forever unresolved if the buyer never
// notices, not a resolution on its own. 30 days, comfortably past the
// point a buyer would normally have noticed and filed manually.
const undeliveredClaimBackstopDays = 30

// shipStrikeWindowDays is the trailing window seller_ship_strikes are
// counted over to decide warning vs. suspension (cancelUnshippedOrders).
const shipStrikeWindowDays = 30

// shipSuspensionDays is how long an account_suspensions row lasts once a
// seller hits their second missed-ship-deadline strike in
// shipStrikeWindowDays.
const shipSuspensionDays = 7

// orderTimerInterval doesn't need auction-close's 2-second cadence — none
// of these deadlines are latency-sensitive to the minute, let alone the
// second. A minute is frequent enough that a 72-hour or 3-day deadline
// never drifts by anything a user would notice.
const orderTimerInterval = 1 * time.Minute

// runOrderTimersLoop ticks every order-lifecycle timer pass on a fixed
// interval until ctx is cancelled — same immediate-first-pass-then-ticker
// shape as runCloseLoop, so orders whose deadline already passed while the
// worker was down get handled right away instead of waiting a full interval.
func runOrderTimersLoop(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, mailClient *mail.Client, webOrigin string) {
	orderTimersOnce(ctx, pool, paymentClient, mailClient, webOrigin)

	ticker := time.NewTicker(orderTimerInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			orderTimersOnce(ctx, pool, paymentClient, mailClient, webOrigin)
		}
	}
}

func orderTimersOnce(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, mailClient *mail.Client, webOrigin string) {
	cancelUnpaidOrders(ctx, pool)
	cancelUnshippedOrders(ctx, pool, paymentClient)
	assumeDeliveredForLetterShipments(ctx, pool, paymentClient)
	escalateUndeliveredOrders(ctx, pool, paymentClient, mailClient, webOrigin)
	releaseElapsedClaimWindows(ctx, pool, paymentClient)
	secondchance.ExpirePending(ctx, pool)
}

// cancelUnpaidOrders enforces the 24-hour payment window a won auction's
// buyer has to actually pay (createPendingOrderForWin inserts the order
// row, state=created, the instant the auction closes — before this
// existed, an order that never got paid just sat in created forever,
// which is why the Transactions list used to show "Payment window
// expired" as a permanent, never-resolving badge instead of a real
// cancellation). updated_at is the entry time into created, since nothing
// touches an order in this state until FinalizePayment moves it on
// (CreateFromWin never updates a row after inserting it).
//
// No refund step here, unlike cancelUnshippedOrders/escalateUndeliveredOrders
// — an order stuck in created never captured a real Stripe charge in the
// first place (FinalizePayment is what would have recorded
// stripe_charge_id), so there is nothing to reverse on Stripe's side. This
// is entirely the buyer's fault, so unlike the ship-deadline path it DOES
// offer the listing to a second-chance bidder — the seller still has a
// good item ready to sell, they just need an actual paying buyer.
func cancelUnpaidOrders(ctx context.Context, pool *pgxpool.Pool) {
	rows, err := pool.Query(ctx, `
		select o.id, o.buyer_id, o.seller_id, oi.listing_id from orders o
		join order_items oi on oi.order_id = o.id
		where o.state = $1 and o.updated_at < now() - interval '1 hour' * $2
	`, string(order.StateCreated), unpaidOrderWindowHours)
	if err != nil {
		log.Printf("worker: query unpaid orders failed: %v", err)
		return
	}
	type row struct{ id, buyerID, sellerID, listingID string }
	var toCancel []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.buyerID, &r.sellerID, &r.listingID); err != nil {
			rows.Close()
			log.Printf("worker: scan unpaid order failed: %v", err)
			return
		}
		toCancel = append(toCancel, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query unpaid orders failed: %v", err)
		return
	}

	for _, r := range toCancel {
		id := r.id
		if err := order.Transition(ctx, pool, id, order.StateCreated, order.StateCancelled); err != nil {
			log.Printf("worker: failed to cancel unpaid order %s: %v", id, err)
			continue
		}
		if _, err := pool.Exec(ctx, `update order_items set voided_at = now() where order_id = $1`, id); err != nil {
			log.Printf("worker: failed to void order_items for unpaid order %s: %v", id, err)
		}
		if err := order.ReleaseAddons(ctx, pool, id); err != nil {
			log.Printf("worker: failed to release add-ons for unpaid order %s: %v", id, err)
		}
		log.Printf("worker: order %s cancelled — %dh payment window expired with no payment", id, unpaidOrderWindowHours)
		secondchance.HandleBuyerFault(ctx, pool, r.listingID, r.sellerID, r.buyerID)
	}
}

// cancelUnshippedOrders enforces the seller's ship-by deadline
// (ship_deadline, stamped by internal/order.Transition on entry to
// awaiting_ship, and the one column RequestShipExtension can push out
// once): AWAITING_SHIP -> CANCELLED with a full refund if the seller
// hasn't marked it shipped in time. This is entirely the seller's fault —
// unlike cancelUnpaidOrders (buyer's fault), this never offers the listing
// to a second-chance bidder (see internal/secondchance's own package doc):
// re-listing the same seller's item to a new buyer doesn't fix an
// unreliable seller, it just repeats the risk. Instead: a strike against
// the seller, escalating to a real (if narrow and time-boxed) suspension
// on the second one within shipStrikeWindowDays.
func cancelUnshippedOrders(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select o.id, o.stripe_payment_intent_id, o.seller_id, oi.listing_id from orders o
		join order_items oi on oi.order_id = o.id
		where o.state = $1 and o.ship_deadline < now()
	`, string(order.StateAwaitingShip))
	if err != nil {
		log.Printf("worker: query unshipped orders failed: %v", err)
		return
	}
	type row struct {
		id, sellerID, listingID string
		piID                    *string
	}
	var toCancel []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.piID, &r.sellerID, &r.listingID); err != nil {
			rows.Close()
			log.Printf("worker: scan unshipped order failed: %v", err)
			return
		}
		toCancel = append(toCancel, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query unshipped orders failed: %v", err)
		return
	}

	for _, r := range toCancel {
		if err := refundAndTransition(ctx, pool, paymentClient, r.id, r.piID, order.StateAwaitingShip, order.StateCancelled); err != nil {
			log.Printf("worker: failed to cancel unshipped order %s: %v", r.id, err)
			continue
		}
		if _, err := pool.Exec(ctx, `update order_items set voided_at = now() where order_id = $1`, r.id); err != nil {
			log.Printf("worker: failed to void order_items for unshipped order %s: %v", r.id, err)
		}
		if err := order.ReleaseAddons(ctx, pool, r.id); err != nil {
			log.Printf("worker: failed to release add-ons for unshipped order %s: %v", r.id, err)
		}
		log.Printf("worker: order %s cancelled — no tracking uploaded within the ship deadline, refunded", r.id)
		recordShipStrike(ctx, pool, r.sellerID, r.id, r.listingID)
	}
}

// recordShipStrike is the graduated seller consequence for missing a ship
// deadline: a warning notification on the first strike within
// shipStrikeWindowDays, or — on the second (or later) — a real
// account_suspensions row. "Currently suspended" is always derived from a
// live query against this table (see its migration comment), never a
// mutable flag, so nothing has to remember to clear it after
// shipSuspensionDays — it just stops matching once ends_at passes.
func recordShipStrike(ctx context.Context, pool *pgxpool.Pool, sellerID, orderID, listingID string) {
	if _, err := pool.Exec(ctx, `
		insert into seller_ship_strikes (seller_id, order_id) values ($1, $2)
	`, sellerID, orderID); err != nil {
		log.Printf("worker: failed to record ship strike for seller %s: %v", sellerID, err)
		return
	}

	var strikeCount int
	if err := pool.QueryRow(ctx, `
		select count(*) from seller_ship_strikes
		where seller_id = $1 and created_at > now() - interval '1 day' * $2
	`, sellerID, shipStrikeWindowDays).Scan(&strikeCount); err != nil {
		log.Printf("worker: failed to count ship strikes for seller %s: %v", sellerID, err)
		return
	}

	if strikeCount < 2 {
		if err := notification.Create(ctx, pool, sellerID, notification.KindShipDeadlineWarning, listingID); err != nil {
			log.Printf("worker: failed to notify ship-deadline warning for seller %s: %v", sellerID, err)
		}
		return
	}

	var alreadySuspended bool
	if err := pool.QueryRow(ctx, `
		select exists(select 1 from account_suspensions where user_id = $1 and now() < ends_at)
	`, sellerID).Scan(&alreadySuspended); err != nil {
		log.Printf("worker: failed to check existing suspension for seller %s: %v", sellerID, err)
		return
	}
	if alreadySuspended {
		return
	}

	if _, err := pool.Exec(ctx, `
		insert into account_suspensions (user_id, reason, ends_at)
		values ($1, 'missed_ship_deadline', now() + interval '1 day' * $2)
	`, sellerID, shipSuspensionDays); err != nil {
		log.Printf("worker: failed to suspend seller %s: %v", sellerID, err)
		return
	}
	if err := notification.Create(ctx, pool, sellerID, notification.KindAccountSuspended, listingID); err != nil {
		log.Printf("worker: failed to notify suspension for seller %s: %v", sellerID, err)
	}
	log.Printf("worker: seller %s suspended for %d days — 2nd missed ship deadline within %d days", sellerID, shipSuspensionDays, shipStrikeWindowDays)
}

// assumeDeliveredForLetterShipments is the letter-mechanism equivalent of a
// carrier "delivered" webhook: Pitney Bowes' IMb tracking only proves the
// mailpiece entered USPS's system, never that it actually reached the
// buyer, so nothing will ever call order.MarkDelivered for these orders
// the way internal/shipping's webhook does for Shippo packages. After
// letterShipmentAssumedDeliveryDays with no other event, this worker
// assumes delivery happened and calls MarkDelivered itself — which still
// runs the normal claim-window/trusted-release logic from there, so a
// buyer's dispute protection isn't shortened just because the shipping
// method is cheaper.
func assumeDeliveredForLetterShipments(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id from orders
		where state = $1 and shipping_preset in ($2, $3)
			and updated_at < now() - interval '1 day' * $4
	`, string(order.StateShipped), string(shipping.PresetTrackedEnvelope), string(shipping.PresetFreeEnvelope), letterShipmentAssumedDeliveryDays)
	if err != nil {
		log.Printf("worker: query undelivered letter shipments failed: %v", err)
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			log.Printf("worker: scan undelivered letter shipment failed: %v", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query undelivered letter shipments failed: %v", err)
		return
	}

	for _, id := range ids {
		if err := order.MarkDelivered(ctx, pool, paymentClient, id); err != nil {
			log.Printf("worker: failed to mark letter shipment %s delivered: %v", id, err)
			continue
		}
		log.Printf("worker: order %s assumed delivered — %d days elapsed on a tracked-envelope shipment with no further event", id, letterShipmentAssumedDeliveryDays)
	}
}

// escalateUndeliveredOrders is the backstop for a shipped package that
// never gets a delivery scan — genuinely ambiguous (lost in transit? the
// seller never actually shipped it despite the tracking number? the buyer
// claiming it never arrived when it did?), so this is deliberately NOT an
// automatic refund the way this job used to work. Instead it opens the new
// not_received_tracking_stalled claim on the buyer's behalf and escalates
// it straight to human review — the exact same OpenClaim+Escalate call
// sequence a real buyer's own "File a claim" click already makes
// (internal/dispute), just system-triggered after
// undeliveredClaimBackstopDays instead of waiting on the buyer to notice.
// `and not exists (claims...)` skips any order a buyer already filed a
// claim on manually, so this never double-escalates.
//
// Package-mechanism orders only (shippo_ground_advantage/free_bubble_mailer/
// free_box, or null for orders that predate the preset feature entirely) —
// letter-mechanism orders (tracked_envelope/free_envelope) never get a real
// delivery scan by design (verified live against Pitney Bowes' current
// API docs — USPS doesn't guarantee tracking events for First-Class Mail
// IMb labels), so they're long since handled by
// assumeDeliveredForLetterShipments's much shorter timer well before this
// one would ever fire.
func escalateUndeliveredOrders(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, mailClient *mail.Client, webOrigin string) {
	rows, err := pool.Query(ctx, `
		select o.id, o.buyer_id from orders o
		where o.state = $1 and o.updated_at < now() - interval '1 day' * $2
			and (o.shipping_preset is null or o.shipping_preset not in ('tracked_envelope', 'free_envelope'))
			and not exists (select 1 from claims where order_id = o.id)
	`, string(order.StateShipped), undeliveredClaimBackstopDays)
	if err != nil {
		log.Printf("worker: query undelivered orders failed: %v", err)
		return
	}
	type row struct{ id, buyerID string }
	var toEscalate []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.buyerID); err != nil {
			rows.Close()
			log.Printf("worker: scan undelivered order failed: %v", err)
			return
		}
		toEscalate = append(toEscalate, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query undelivered orders failed: %v", err)
		return
	}

	for _, r := range toEscalate {
		claimID, err := dispute.OpenClaim(ctx, pool, r.id, r.buyerID, dispute.ReasonNotReceivedTrackingStalled, "")
		if err != nil {
			log.Printf("worker: failed to auto-file claim for undelivered order %s: %v", r.id, err)
			continue
		}
		if err := dispute.Escalate(ctx, pool, paymentClient, mailClient, webOrigin, claimID); err != nil {
			log.Printf("worker: failed to escalate auto-filed claim %s for order %s: %v", claimID, r.id, err)
			continue
		}
		log.Printf("worker: order %s auto-escalated to human review — no delivery scan within %d days of shipping and no claim filed", r.id, undeliveredClaimBackstopDays)
	}
}

// refundAndTransition issues a real Stripe refund (best-effort — a failed
// refund is logged, not left to block the state transition entirely, since
// the buyer having their money back is what actually matters and a stuck
// order helps nobody) then performs the state transition. No seller
// Connect lookup needed anymore — separate charges and transfers
// (docs/Legal_MoneyTransitter.md) means the charge being refunded always
// lives on the platform's own Stripe account, regardless of the seller's
// Connect state.
func refundAndTransition(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID string, piID *string, from, to order.State) error {
	if paymentClient.IsConfigured() && piID != nil {
		if err := paymentClient.Refund(ctx, *piID); err != nil {
			log.Printf("worker: refund failed for order %s: %v", orderID, err)
		}
	}
	return order.Transition(ctx, pool, orderID, from, to)
}

// releaseElapsedClaimWindows enforces design doc v2 §5.2's claim-window
// timer: CLAIM_WINDOW -> RELEASED once claim_deadline has passed (3 or 7
// days, set by order.MarkDelivered based on order value) with no claim
// filed. A buyer who files a claim first moves the order to CLAIM_OPEN
// (internal/dispute, Phase 8 — not built yet) before this timer would ever
// fire, so this query never needs to check for an open claim itself.
func releaseElapsedClaimWindows(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id from orders
		where state = $1 and claim_deadline is not null and claim_deadline < now()
	`, string(order.StateClaimWindow))
	if err != nil {
		log.Printf("worker: query elapsed claim windows failed: %v", err)
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			log.Printf("worker: scan elapsed claim window failed: %v", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query elapsed claim windows failed: %v", err)
		return
	}

	for _, id := range ids {
		if err := order.Transition(ctx, pool, id, order.StateClaimWindow, order.StateReleased); err != nil {
			log.Printf("worker: failed to release order %s: %v", id, err)
			continue
		}
		if _, err := pool.Exec(ctx, `update orders set released_at = now() where id = $1`, id); err != nil {
			log.Printf("worker: failed to stamp released_at for order %s: %v", id, err)
		}

		// Same guard as internal/dispute's releaseOrder: a real chargeback
		// can arrive independent of anything the claim-window timer knows
		// about, and must stop this order from paying out regardless.
		if blocked, err := chargeback.HasBlockingChargeback(ctx, pool, id); err != nil {
			log.Printf("worker: failed to check chargeback status for order %s: %v", id, err)
		} else if blocked {
			log.Printf("worker: order %s has a pending or lost chargeback — withholding seller payout", id)
			continue
		}

		if err := order.ReleaseFunds(ctx, pool, paymentClient, id); err != nil {
			log.Printf("worker: failed to release funds for order %s: %v", id, err)
		}
		log.Printf("worker: order %s released — claim window elapsed with no claim filed", id)
	}
}
