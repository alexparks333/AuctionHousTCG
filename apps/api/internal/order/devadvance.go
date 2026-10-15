package order

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
)

// AllowDevAdvance gates DevAdvance — set once at boot from
// platform.Config.Environment (cmd/api/main.go, alongside
// listing.AllowDevDurations/seller.AllowDevTierAdjust), never flipped
// per-request. Off in production regardless of whether a client somehow
// reaches the route at all — belt-and-suspenders, same shape as every
// other dev-only affordance in this codebase.
var AllowDevAdvance = true

// ErrDevAdvanceDisabled is returned by DevAdvance when AllowDevAdvance is
// false.
var ErrDevAdvanceDisabled = errors.New("order: dev advance is disabled outside development")

// ErrNothingToAdvance is returned for any state DevAdvance doesn't know how
// to push forward — a terminal state (released/refunded/cancelled), an
// open claim (resolve that for real, through the actual claim flow), or
// one of the payment states that resolve straight through to
// awaiting_ship within the same request that created them
// (created/payment_pending/paid) — a real order is never actually seen
// sitting in one of those by the time it shows up on the Transactions list.
var ErrNothingToAdvance = errors.New("order: nothing to advance from this state")

// devEvidenceURL is the placeholder recorded for the three photo evidence
// types MarkShipped requires — there's no real card to photograph on a
// dev order pushed forward by this button, so this stands in for "the
// seller would have uploaded a real photo here."
const devEvidenceURL = "dev:auto-evidence"

// DevAdvance pushes orderID exactly one step forward through the same real
// transitions a live shipment goes through — MarkShipped, MarkDelivered,
// and the claim-window-elapsed release cmd/worker's
// releaseElapsedClaimWindows performs on its own 1-minute ticker — so the
// shipping/delivery/claim-window flow can be exercised end to end without
// waiting on the 72-hour ship clock, a real carrier scan, or the 3/7-day
// claim window. This exists because there is no way to test a real
// end-to-end card shipment in dev — see the Transactions page's dev
// "advance" button (TransactionStepper.tsx) — so this is the dev stand-in
// for "the seller shipped it, then the carrier delivered it," not a second
// legitimate way to reach any of these states.
//
// Bypasses the requiredForShip evidence gate by seeding the three required
// photo types with a placeholder URL first, then calling the exact same
// MarkShipped a real seller's "mark as shipped" action calls — so besides
// the placeholder photos, this exercises the real code path, not a
// parallel shortcut around it. Same idea for delivery and claim-window
// release: MarkDelivered and the release logic below are the real thing,
// just triggered on demand instead of by a webhook or a timer.
func DevAdvance(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID, callerID string) (*Order, error) {
	if !AllowDevAdvance {
		return nil, ErrDevAdvanceDisabled
	}

	o, err := GetByID(ctx, pool, orderID)
	if err != nil {
		return nil, err
	}
	if !requireParticipant(o, callerID) {
		return nil, ErrNotParticipant
	}

	switch o.State {
	case StateAwaitingShip:
		for _, t := range requiredForShip {
			if _, err := pool.Exec(ctx, `
				insert into order_evidence (order_id, uploaded_by, type, url) values ($1, $2, $3, $4)
			`, orderID, o.SellerID, string(t), devEvidenceURL); err != nil {
				return nil, fmt.Errorf("seed dev evidence: %w", err)
			}
		}
		if err := MarkShipped(ctx, pool, orderID, o.SellerID, "DEV", "DEV-"+orderID); err != nil {
			return nil, err
		}
	case StateShipped:
		if err := MarkDelivered(ctx, pool, paymentClient, orderID); err != nil {
			return nil, err
		}
	case StateClaimWindow:
		if err := ReleaseClaimWindow(ctx, pool, paymentClient, orderID); err != nil {
			return nil, err
		}
	default:
		return nil, ErrNothingToAdvance
	}

	return GetByID(ctx, pool, orderID)
}
