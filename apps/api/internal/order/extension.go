package order

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/payment"
)

var (
	ErrNotAwaitingShip      = errors.New("order: this order isn't awaiting shipment")
	ErrExtensionAlreadyUsed = errors.New("order: a shipping extension has already been used on this order")
)

// shipExtensionPct is the flat cut taken off the item's own price
// (subtotal_cents, never shipping/tax) when a seller requests more time to
// ship — refunded to the buyer as compensation for the delay, deducted
// from the seller's own eventual payout. One-time per order (see
// ShipExtensionUsedAt), +ShipWindowHours more time.
const shipExtensionPct = 0.10

// RequestShipExtension is the seller's one-time "I need more time to
// ship" action (Transactions page, Pending Shipment view) — validates the
// caller is the seller, the order is genuinely awaiting_ship, and this
// hasn't been used before; issues a real partial Stripe refund to the
// buyer's original charge (paymentClient.RefundAmount) for
// shipExtensionPct of the item's price, reduces the seller's own eventual
// net payout by that same amount so the deduction actually lands on them
// rather than the platform, pushes ship_deadline out by ShipWindowHours,
// and stamps ShipExtensionUsedAt so a second request is rejected. The
// buyer is notified with the amount and new deadline.
func RequestShipExtension(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, listingID, sellerID string) (*Order, error) {
	o, err := GetForListing(ctx, pool, listingID)
	if err != nil {
		return nil, err
	}
	if sellerID != o.SellerID {
		return nil, ErrNotSeller
	}
	if o.State != StateAwaitingShip {
		return nil, ErrNotAwaitingShip
	}
	if o.ShipExtensionUsedAt != nil {
		return nil, ErrExtensionAlreadyUsed
	}

	discountCents := int64(float64(o.SubtotalCents) * shipExtensionPct)

	if paymentClient.IsConfigured() && o.StripePaymentIntentID != nil {
		if err := paymentClient.RefundAmount(ctx, *o.StripePaymentIntentID, discountCents); err != nil {
			return nil, fmt.Errorf("refund shipping-extension discount: %w", err)
		}
	}

	tag, err := pool.Exec(ctx, `
		update orders set
			seller_net_cents = seller_net_cents - $1,
			ship_deadline = ship_deadline + interval '1 hour' * $2,
			ship_extension_used_at = now()
		where id = $3 and state = $4 and ship_extension_used_at is null
	`, discountCents, ShipWindowHours, o.ID, string(StateAwaitingShip))
	if err != nil {
		return nil, fmt.Errorf("apply shipping extension: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrExtensionAlreadyUsed
	}

	if err := notification.Create(ctx, pool, o.BuyerID, notification.KindShipExtensionGranted, listingID); err != nil {
		return nil, fmt.Errorf("notify buyer of extension: %w", err)
	}

	return GetForListing(ctx, pool, listingID)
}
