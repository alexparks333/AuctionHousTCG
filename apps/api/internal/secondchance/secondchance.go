// Package secondchance implements eBay's "Second Chance Offer" — when a
// won auction's sale falls through for a reason that's the BUYER's fault
// (never paid at all, or paid and later reversed it via a bank chargeback
// before the item ever shipped), the seller still has a good item ready to
// sell, so it's re-offered to the runner-up bidder at their own real last
// max bid, with a time-limited window to accept.
//
// Deliberately never triggered for a seller-fault failure (missed the ship
// deadline) — that seller has just demonstrated they're unreliable, so
// re-offering the same item through them to a new buyer doesn't fix
// anything. That path is internal/order's ship-deadline strikes/suspension
// system instead (cmd/worker/order_timers.go's cancelUnshippedOrders).
package secondchance

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/auction"
	"auctionhous-tcg/api/internal/notification"
)

// offerWindow is how long the runner-up has to accept before it expires —
// the user's own "48h to accept" example.
const offerWindow = 48 * time.Hour

type Status string

const (
	StatusPending  Status = "pending"
	StatusAccepted Status = "accepted"
	StatusDeclined Status = "declined"
	StatusExpired  Status = "expired"
)

var (
	ErrNotFound       = errors.New("second-chance offer not found")
	ErrNotParticipant = errors.New("not the bidder this offer was made to")
	ErrNotPending     = errors.New("this offer is no longer pending")
	ErrExpired        = errors.New("this offer has expired")
)

// Offer is denormalized with the listing's title/photo and the seller's
// username, same "no N+1 per row" shape as internal/offer.Offer.
type Offer struct {
	ID              string     `json:"id"`
	ListingID       string     `json:"listingId"`
	ListingTitle    string     `json:"listingTitle"`
	ListingImageURL string     `json:"listingImageUrl,omitempty"`
	SellerID        string     `json:"sellerId"`
	SellerUsername  *string    `json:"sellerUsername"`
	BidderID        string     `json:"bidderId"`
	AmountCents     int64      `json:"amountCents"`
	Status          Status     `json:"status"`
	ExpiresAt       time.Time  `json:"expiresAt"`
	CreatedAt       time.Time  `json:"createdAt"`
	RespondedAt     *time.Time `json:"respondedAt,omitempty"`
}

const selectColumns = `
	sco.id, sco.listing_id, l.title, l.image_urls,
	sco.seller_id, su.username, sco.bidder_id,
	sco.amount_cents, sco.status, sco.expires_at, sco.created_at, sco.responded_at
`

const fromClause = `
	from second_chance_offers sco
	join listings l on l.id = sco.listing_id
	join users su on su.id = sco.seller_id
`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanOffer(row rowScanner) (*Offer, error) {
	var o Offer
	var imageURLs []string
	var status string
	if err := row.Scan(
		&o.ID, &o.ListingID, &o.ListingTitle, &imageURLs,
		&o.SellerID, &o.SellerUsername, &o.BidderID,
		&o.AmountCents, &status, &o.ExpiresAt, &o.CreatedAt, &o.RespondedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan second-chance offer: %w", err)
	}
	if len(imageURLs) > 0 {
		o.ListingImageURL = imageURLs[0]
	}
	o.Status = Status(status)
	return &o, nil
}

// Get returns one offer by id, for the accept/decline page.
func Get(ctx context.Context, pool *pgxpool.Pool, offerID string) (*Offer, error) {
	row := pool.QueryRow(ctx, `select `+selectColumns+fromClause+` where sco.id = $1`, offerID)
	return scanOffer(row)
}

// FindRunnerUp picks the listing's next-highest bidder, excluding
// excludeBidderID (the buyer whose own win just fell through) — their own
// real max bid, not re-derived through the increment grid, since there's
// no rival bidder left to "beat." Ties break on whoever placed that max
// first (min(placed_at)), a deterministic and defensible rule absent any
// other precedent for it in this codebase.
func FindRunnerUp(ctx context.Context, pool *pgxpool.Pool, listingID, excludeBidderID string) (bidderID string, maxBidCents int64, found bool, err error) {
	err = pool.QueryRow(ctx, `
		select bidder_id, max(max_bid_cents) as m
		from bids
		where auction_listing_id = $1 and bidder_id <> $2
		group by bidder_id
		order by m desc, min(placed_at) asc
		limit 1
	`, listingID, excludeBidderID).Scan(&bidderID, &maxBidCents)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", 0, false, nil
		}
		return "", 0, false, fmt.Errorf("find runner-up: %w", err)
	}
	return bidderID, maxBidCents, true, nil
}

// HandleBuyerFault is the shared trigger for every buyer-fault sale
// failure — never paid (cmd/worker's cancelUnpaidOrders) and a chargeback
// lost before the item ever shipped (internal/chargeback.RecordStatusChange).
// Never called for the seller-fault ship-timeout path (see package doc).
//
// One shot, no cascade: if a second_chance_offers row already exists for
// this listing (any status — a prior offer already ran its course, whether
// accepted-then-also-failed, declined, or expired), this doesn't go
// hunting for a third bidder. It just notifies the seller to relist, same
// as "no runner-up at all." Best-effort throughout — a failure here must
// never make the caller's own already-committed cancellation/refund look
// like it failed, same reasoning as every other post-decision step in
// this codebase (e.g. internal/order.ReleaseFunds).
func HandleBuyerFault(ctx context.Context, pool *pgxpool.Pool, listingID, sellerID, excludeBidderID string) {
	var alreadyRan bool
	if err := pool.QueryRow(ctx, `
		select exists(select 1 from second_chance_offers where listing_id = $1)
	`, listingID).Scan(&alreadyRan); err != nil {
		log.Printf("secondchance: failed to check existing offers for listing %s: %v", listingID, err)
		return
	}
	if alreadyRan {
		notifyRelist(ctx, pool, sellerID, listingID)
		return
	}

	bidderID, maxBidCents, found, err := FindRunnerUp(ctx, pool, listingID, excludeBidderID)
	if err != nil {
		log.Printf("secondchance: failed to find runner-up for listing %s: %v", listingID, err)
		return
	}
	if !found {
		notifyRelist(ctx, pool, sellerID, listingID)
		return
	}

	var offerID string
	if err := pool.QueryRow(ctx, `
		insert into second_chance_offers (listing_id, seller_id, bidder_id, amount_cents, expires_at)
		values ($1, $2, $3, $4, $5)
		returning id
	`, listingID, sellerID, bidderID, maxBidCents, time.Now().Add(offerWindow)).Scan(&offerID); err != nil {
		log.Printf("secondchance: failed to create offer for listing %s: %v", listingID, err)
		return
	}
	if err := notification.CreateForSecondChance(ctx, pool, bidderID, notification.KindSecondChanceOffer, listingID, offerID); err != nil {
		log.Printf("secondchance: failed to notify bidder for offer %s: %v", offerID, err)
	}
}

func notifyRelist(ctx context.Context, pool *pgxpool.Pool, sellerID, listingID string) {
	if err := notification.Create(ctx, pool, sellerID, notification.KindListingNeedsRelist, listingID); err != nil {
		log.Printf("secondchance: failed to notify seller to relist listing %s: %v", listingID, err)
	}
}

// Accept is the runner-up taking the offer — row-locks it, validates the
// caller is actually who it was offered to and it's still pending and
// unexpired, CASes the status, commits, then best-effort creates the same
// real unpaid order a regular auction win creates
// (auction.CreatePendingOrderForWin — already exported and already reused
// by internal/offer.Accept for its own accept-closes-the-sale step). The
// buyer still has to actually pay through the normal checkout flow from
// there, 24h window and all — a non-paying runner-up hits
// cmd/worker's cancelUnpaidOrders again, which correctly treats that as a
// repeat failure (HandleBuyerFault's alreadyRan check above), not a reason
// to hunt for a third bidder.
func Accept(ctx context.Context, pool *pgxpool.Pool, bidderID, offerID string) (*Offer, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		listingID      string
		sellerID       string
		actualBidderID string
		amountCents    int64
		status         string
		expiresAt      time.Time
	)
	err = tx.QueryRow(ctx, `
		select listing_id, seller_id, bidder_id, amount_cents, status, expires_at
		from second_chance_offers where id = $1 for update
	`, offerID).Scan(&listingID, &sellerID, &actualBidderID, &amountCents, &status, &expiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read offer: %w", err)
	}
	if actualBidderID != bidderID {
		return nil, ErrNotParticipant
	}
	if status != string(StatusPending) {
		return nil, ErrNotPending
	}
	if time.Now().After(expiresAt) {
		return nil, ErrExpired
	}

	if _, err := tx.Exec(ctx, `
		update second_chance_offers set status = $1, responded_at = now() where id = $2
	`, string(StatusAccepted), offerID); err != nil {
		return nil, fmt.Errorf("update offer: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	var shippingPreset string
	var estimatedShippingCents *int64
	var requestSignature bool
	if err := pool.QueryRow(ctx, `
		select shipping_preset, estimated_shipping_cents, request_signature from listings where id = $1
	`, listingID).Scan(&shippingPreset, &estimatedShippingCents, &requestSignature); err != nil {
		log.Printf("secondchance: failed to read listing shipping fields for %s: %v", listingID, err)
		return Get(ctx, pool, offerID)
	}
	auction.CreatePendingOrderForWin(ctx, pool, listingID, actualBidderID, sellerID, amountCents, shippingPreset, estimatedShippingCents, requestSignature)

	return Get(ctx, pool, offerID)
}

// Decline mirrors Accept for the reject path — notifies the seller to
// relist, same as an ignored offer eventually expiring.
func Decline(ctx context.Context, pool *pgxpool.Pool, bidderID, offerID string) (*Offer, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		listingID      string
		sellerID       string
		actualBidderID string
		status         string
	)
	err = tx.QueryRow(ctx, `
		select listing_id, seller_id, bidder_id, status from second_chance_offers where id = $1 for update
	`, offerID).Scan(&listingID, &sellerID, &actualBidderID, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read offer: %w", err)
	}
	if actualBidderID != bidderID {
		return nil, ErrNotParticipant
	}
	if status != string(StatusPending) {
		return nil, ErrNotPending
	}

	if _, err := tx.Exec(ctx, `
		update second_chance_offers set status = $1, responded_at = now() where id = $2
	`, string(StatusDeclined), offerID); err != nil {
		return nil, fmt.Errorf("update offer: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	notifyRelist(ctx, pool, sellerID, listingID)
	return Get(ctx, pool, offerID)
}

// ExpirePending is cmd/worker's timer sweep — every offer past its
// expires_at with no response, CASed straight to expired and the seller
// notified, same shape as every other timer in cmd/worker/order_timers.go.
func ExpirePending(ctx context.Context, pool *pgxpool.Pool) {
	rows, err := pool.Query(ctx, `
		update second_chance_offers set status = 'expired', responded_at = now()
		where status = 'pending' and expires_at < now()
		returning listing_id, seller_id
	`)
	if err != nil {
		log.Printf("secondchance: query expiring offers failed: %v", err)
		return
	}
	type row struct{ listingID, sellerID string }
	var expired []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.listingID, &r.sellerID); err != nil {
			rows.Close()
			log.Printf("secondchance: scan expiring offer failed: %v", err)
			return
		}
		expired = append(expired, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("secondchance: query expiring offers failed: %v", err)
		return
	}
	for _, r := range expired {
		notifyRelist(ctx, pool, r.sellerID, r.listingID)
		log.Printf("secondchance: offer on listing %s expired unanswered", r.listingID)
	}
}
