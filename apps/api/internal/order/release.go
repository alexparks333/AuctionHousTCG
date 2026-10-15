package order

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/seller"
)

// ReleaseFunds is the money-movement half of every path that lands an
// order in the released state (claim window elapsed with no claim,
// MarkDelivered's trusted-seller instant release, or a claim resolving in
// the seller's favor) — separate charges and transfers
// (docs/Legal_MoneyTransitter.md) means the buyer's charge has sat in the
// PLATFORM's own Stripe balance the whole time up to this point, so
// reaching released doesn't move any money on its own; this is the one
// explicit Transfer call that actually does. Callers are expected to have
// already performed the released state transition (and stamped
// released_at) before calling this — ReleaseFunds only ever moves money,
// it never touches order state itself.
//
// The transferred amount is seller_net_cents minus refunded_cents minus
// label_cost_cents. The label deduction matters for both shipping-cost
// cases this platform supports: on a paid preset, the buyer's shipping
// payment already inflated seller_net_cents by roughly shipping_cents, and
// the platform then spends real money buying that seller a label via
// Shippo/Pitney Bowes — without this deduction the seller would keep the
// shipping charge AND receive a free label, effectively double-paid for
// shipping. On a free preset, shipping_cents is 0 (the buyer was charged
// nothing) but the seller still promised to cover shipping themselves —
// deducting the label's real cost here is what actually makes that
// promise land on the seller rather than silently landing on the
// platform, which is what happens without this (the gap was found via a
// free_envelope auction that auto-upgrades to free_bubble_mailer,
// shipping.UpgradePreset — a real Shippo Ground Advantage label costs
// meaningfully more than the flat envelope rate the seller had in mind).
// label_cost_cents is null whenever a seller shipped manually (never
// bought a label through this platform) — no deduction in that case,
// since the platform never spent anything on their behalf.
//
// A partial refund (internal/dispute.executePartialRefund) comes entirely
// out of the seller's take, never the platform's fee, so by the time an
// order actually reaches released its remaining entitlement may already be
// less than what was quoted at sale time. Best-effort: a failed Transfer is
// returned to the caller to log, never left to block the order's state
// transition that already happened — a seller not yet paid out is a
// recoverable, visible problem; an order stuck mid-transition helps no one.
func ReleaseFunds(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID string) error {
	if !paymentClient.IsConfigured() {
		return nil
	}

	var sellerID string
	var sellerNetCents, refundedCents int64
	var labelCostCents *int64
	if err := pool.QueryRow(ctx, `
		select seller_id, seller_net_cents, refunded_cents, label_cost_cents from orders where id = $1
	`, orderID).Scan(&sellerID, &sellerNetCents, &refundedCents, &labelCostCents); err != nil {
		return fmt.Errorf("read order for release: %w", err)
	}

	amountCents := sellerNetCents - refundedCents
	if labelCostCents != nil {
		amountCents -= *labelCostCents
	}
	// A label costing more than the seller's remaining net (a cheap
	// free-shipping item where the real label rate exceeds the item's own
	// proceeds) just skips the transfer rather than going negative — there
	// is no mechanism to claw back funds from a seller after the fact, so
	// the platform absorbs that gap rather than the seller ending up owing
	// money. Rare in practice (it needs a free-shipping order whose label
	// cost outweighs its own net), but a real possible outcome, not a bug.
	if amountCents <= 0 {
		return nil
	}

	stripeAccountID, err := seller.StripeAccountID(ctx, pool, sellerID)
	if err != nil {
		return err
	}
	if stripeAccountID == "" {
		return fmt.Errorf("order %s: seller %s has no stripe account to transfer to", orderID, sellerID)
	}

	tr, err := paymentClient.CreateTransfer(ctx, stripeAccountID, amountCents)
	if err != nil {
		return fmt.Errorf("transfer released funds: %w", err)
	}

	if _, err := pool.Exec(ctx, `
		update orders set stripe_transfer_id = $1 where id = $2
	`, tr.ID, orderID); err != nil {
		return fmt.Errorf("record transfer id: %w", err)
	}
	return nil
}

// ReleaseClaimWindow performs the claim_window -> released transition and
// its money movement together — the state transition, stamping
// released_at, a chargeback guard, and the best-effort ReleaseFunds call.
// Shared by every path that lands an order in released from claim_window:
// cmd/worker's releaseElapsedClaimWindows timer (claim_deadline passed with
// no claim filed), DevAdvance's dev-only stand-in for that same timer, and
// ReleaseNow below (the buyer choosing to release early instead of waiting
// out the window). internal/order can't import internal/chargeback (it
// imports this package, to resolve a dispute against an order), so the
// chargeback check is the same inline query cmd/worker's own version uses
// rather than a shared chargeback.HasBlockingChargeback call — keep the
// status list in sync with internal/chargeback's blocksRelease map if that
// ever changes.
func ReleaseClaimWindow(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID string) error {
	if err := Transition(ctx, pool, orderID, StateClaimWindow, StateReleased); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `update orders set released_at = now() where id = $1`, orderID); err != nil {
		return fmt.Errorf("stamp released_at: %w", err)
	}

	var blocked bool
	if err := pool.QueryRow(ctx, `
		select exists(
			select 1 from chargebacks
			where order_id = $1 and status not in ('won', 'warning_closed', 'prevented')
		)
	`, orderID).Scan(&blocked); err != nil {
		return fmt.Errorf("check chargeback status: %w", err)
	}
	if blocked {
		log.Printf("order: order %s has a pending or lost chargeback — withholding seller payout", orderID)
		return nil
	}

	// Best-effort, same reasoning as every other release site — a failed
	// Transfer here must never make the caller's action (a timer tick, a
	// dev button, a buyer's own click) look like it failed; the order's
	// released state is already correct regardless.
	if err := ReleaseFunds(ctx, pool, paymentClient, orderID); err != nil {
		log.Printf("order: failed to release funds for order %s: %v", orderID, err)
	}
	return nil
}

// ErrNotBuyer is returned by ReleaseNow when the caller isn't this order's
// buyer — releasing funds early is the buyer's own call to make (the same
// party design doc v2 §9.3 lets file a claim instead), never the seller's.
var ErrNotBuyer = errors.New("order: only the buyer can release funds to the seller")

// ReleaseNow is the buyer's manual "Release to Seller" action on the
// Transactions list (TransactionStepper) — lets a buyer who's satisfied
// with their order skip the rest of the claim_deadline countdown and
// release funds immediately, instead of waiting for
// cmd/worker's releaseElapsedClaimWindows timer to do it once the window
// elapses. Only legal from claim_window (Transition's own table rejects
// every other edge), and only the buyer may call it — a seller releasing
// their own funds early isn't a real action, it's just what the timer
// already does for them. This is a one-way door: once released, there is
// no transition back to claim_window (see the transitions table), so a
// buyer who changes their mind afterward has to file a claim and let
// internal/dispute's normal resolution path run, same as any other
// already-released order.
func ReleaseNow(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID, callerID string) (*Order, error) {
	o, err := GetByID(ctx, pool, orderID)
	if err != nil {
		return nil, err
	}
	if callerID != o.BuyerID {
		return nil, ErrNotBuyer
	}
	if o.State != StateClaimWindow {
		return nil, ErrInvalidTransition
	}

	if err := ReleaseClaimWindow(ctx, pool, paymentClient, orderID); err != nil {
		return nil, err
	}
	return GetByID(ctx, pool, orderID)
}
