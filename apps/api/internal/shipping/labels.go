package shipping

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxLabelsPerOrder caps how many labels can be bought for one order: the
// original plus two "Change Shipping Label" replacements. Replaced Shippo
// labels are refunded, but tracked-envelope labels can't be, and their cost
// comes out of the sale — without a cap, repeated replacements could cost
// more than the sale earns (and AuctionHous absorbs any shortfall).
const MaxLabelsPerOrder = 3

// ErrLabelPurchaseInProgress means another request is already buying a
// label for this order.
var ErrLabelPurchaseInProgress = errors.New("a shipping label is already being bought for this order")

// withLabelLock runs fn while holding a per-order Postgres advisory lock, so
// two simultaneous "Buy label" clicks (or two tabs) can't both buy a label.
// The lock is session-level on a dedicated connection and released when fn
// returns; a crash releases it with the connection.
func withLabelLock(ctx context.Context, pool *pgxpool.Pool, orderID string, fn func() error) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`select pg_try_advisory_lock(hashtextextended('shipping-label:' || $1, 0))`, orderID,
	).Scan(&locked); err != nil {
		return fmt.Errorf("take label lock: %w", err)
	}
	if !locked {
		return ErrLabelPurchaseInProgress
	}
	defer conn.Exec(context.WithoutCancel(ctx),
		`select pg_advisory_unlock(hashtextextended('shipping-label:' || $1, 0))`, orderID)
	return fn()
}

func countLabels(ctx context.Context, pool *pgxpool.Pool, orderID string) (int, error) {
	var n int
	if err := pool.QueryRow(ctx, `select count(*) from shipping_labels where order_id = $1`, orderID).Scan(&n); err != nil {
		return 0, fmt.Errorf("count labels: %w", err)
	}
	return n, nil
}

func recordLabel(ctx context.Context, pool *pgxpool.Pool, orderID string, mechanism Mechanism, l *Label) error {
	_, err := pool.Exec(ctx, `
		insert into shipping_labels (order_id, mechanism, provider_id, carrier, tracking_number, cost_cents)
		values ($1, $2, $3, $4, $5, $6)`,
		orderID, string(mechanism), l.ProviderShipmentID, l.Carrier, l.TrackingNumber, l.CostCents)
	if err != nil {
		return fmt.Errorf("record label: %w", err)
	}
	return nil
}

// recordRefund stores the outcome of a refund request for one of the order's
// labels. status is "requested", "refunded" or "rejected".
func recordRefund(ctx context.Context, pool *pgxpool.Pool, orderID, providerID, status, detail string) error {
	_, err := pool.Exec(ctx, `
		update shipping_labels
		set refund_status = $3, refund_requested_at = coalesce(refund_requested_at, now()), refund_detail = nullif($4, '')
		where order_id = $1 and provider_id = $2`,
		orderID, providerID, status, detail)
	if err != nil {
		return fmt.Errorf("record refund: %w", err)
	}
	return nil
}

// RefundUnusedPackageLabel refunds the order's current Shippo label when the
// order is cancelled before shipping (cmd/worker's ship-deadline cancel) —
// the label will never be used. A no-op for envelope labels (not refundable)
// and orders with no label. Errors are for logging; the cancellation itself
// has already happened.
func RefundUnusedPackageLabel(ctx context.Context, pool *pgxpool.Pool, shippoClient *Client, orderID string) error {
	var providerID string
	err := pool.QueryRow(ctx, `
		select provider_id from shipping_labels
		where order_id = $1 and mechanism = 'package' and refund_status is null
		order by created_at desc limit 1`, orderID).Scan(&providerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // no unrefunded package label
	}
	if err != nil {
		return fmt.Errorf("find label to refund: %w", err)
	}
	if !shippoClient.IsConfigured() {
		return errors.New("shippo not configured; label not refunded")
	}
	status, err := shippoClient.RefundLabel(ctx, providerID)
	if err != nil {
		_ = recordRefund(ctx, pool, orderID, providerID, "rejected", err.Error())
		return err
	}
	return recordRefund(ctx, pool, orderID, providerID, string(status), "")
}
