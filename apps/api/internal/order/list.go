package order

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

// Summary is one row of the Transactions list — an Order plus exactly the
// denormalized fields that view needs (listing title/photo, and whichever
// side of the trade ISN'T the caller), so the frontend never has to
// separately fetch every listing just to render a list of orders. Embeds
// Order so every field on the order-status page's Order type is already
// here too — Summary is a superset, not a parallel shape.
type Summary struct {
	Order
	ListingTitle         string  `json:"listingTitle"`
	ListingImageURL      *string `json:"listingImageUrl,omitempty"`
	CounterpartyID       string  `json:"counterpartyId"`
	CounterpartyUsername *string `json:"counterpartyUsername"`
	// SellerUsername/BuyerUsername are both sides' usernames, unconditional
	// on viewer perspective — unlike CounterpartyUsername (which side ISN'T
	// the caller), the Transactions list's csfloat-style stepper always
	// shows Seller on one end and Buyer on the other regardless of which
	// one the viewer is, so it needs both names, not just "the other one."
	SellerUsername *string `json:"sellerUsername"`
	BuyerUsername  *string `json:"buyerUsername"`
	// ViewerIsSeller tells the client which side of this order the caller
	// is on without having to compare ids itself against its own session —
	// same "derive server-side, don't re-derive client-side" rule as the
	// rest of this codebase's auth-adjacent fields.
	ViewerIsSeller bool `json:"viewerIsSeller"`
	// BundleCardCount is how many extra cards were added to this order at
	// checkout ("Add Singles To Your Order", order_addons, voided lines
	// excluded) — 0 for a plain one-card order. BundleListingIDs are the
	// add-on lines that were whole listings (not Singles Shop singles), so
	// the Selling page can mark those listings as part of a bundle too.
	BundleCardCount  int      `json:"bundleCardCount"`
	BundleListingIDs []string `json:"bundleListingIds"`
	// SinglesOrder means this is a singles-only order: its "listing" is the
	// hidden container (listing.Listing.SinglesOrder) and every card in it
	// is counted in BundleCardCount.
	SinglesOrder bool `json:"singlesOrder"`
	// SinglesCoverURL is a singles order's thumbnail: its first card's
	// catalog image (the container has no photo of its own). A TCG Haven
	// catalog URL, not Supabase Storage, so it's rendered as a plain <img>.
	SinglesCoverURL *string `json:"singlesCoverUrl,omitempty"`
}

// ListForUser returns every order userID is a participant in, either as
// buyer or seller, newest first — the Transactions tab's one query. Each
// row already carries the listing's title/first photo and the other
// party's username, so the list can render without N+1 listing fetches.
func ListForUser(ctx context.Context, pool *pgxpool.Pool, userID string) ([]Summary, error) {
	rows, err := pool.Query(ctx, `
		select `+selectOrderColumns+`,
			l.title, l.image_urls[1],
			case when o.buyer_id = $1 then o.seller_id else o.buyer_id end,
			case when o.buyer_id = $1 then su.username else bu.username end,
			su.username, bu.username,
			coalesce((select sum(a.quantity) from order_addons a where a.order_id = o.id and a.voided_at is null), 0)::int,
			coalesce((select array_agg(a.listing_id::text) from order_addons a
				where a.order_id = o.id and a.voided_at is null and a.listing_id is not null), '{}'),
			l.singles_order,
			case when l.singles_order then (
				select s.image_url from order_addons a join shop_singles s on s.id = a.shop_single_id
				where a.order_id = o.id and s.image_url is not null order by a.created_at limit 1
			) end
		from orders o
		join order_items oi on oi.order_id = o.id
		join listings l on l.id = oi.listing_id
		join users su on su.id = o.seller_id
		join users bu on bu.id = o.buyer_id
		where o.buyer_id = $1 or o.seller_id = $1
		order by o.created_at desc
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("query orders for user: %w", err)
	}
	defer rows.Close()

	out := []Summary{}
	for rows.Next() {
		s, err := scanSummary(rows, userID)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func scanSummary(row pgx.Row, viewerID string) (*Summary, error) {
	var s Summary
	o := &s.Order
	err := row.Scan(
		&o.ID, &o.ListingID, &o.BuyerID, &o.SellerID, &o.State, &o.Rail, &o.TierAtSale,
		&o.TierPctAtSale,
		&o.SubtotalCents, &o.ShippingCents, &o.SellerFeeCents, &o.SellerNetCents,
		&o.DiscountCents, &o.TaxCents, &o.ChargedCents, &o.TrackingNumber, &o.Carrier,
		&o.ShippedAt, &o.DeliveredAt, &o.ClaimDeadline, &o.ReleasedAt,
		&o.ShipDeadline, &o.ShipExtensionUsedAt, &o.CreatedAt,
		&o.StripePaymentIntentID, &o.ShippingPreset, &o.SignatureRequired,
		&o.ProviderShipmentID, &o.LabelCostCents, &o.LabelURL,
		&s.ListingTitle, &s.ListingImageURL, &s.CounterpartyID, &s.CounterpartyUsername,
		&s.SellerUsername, &s.BuyerUsername,
		&s.BundleCardCount, &s.BundleListingIDs, &s.SinglesOrder, &s.SinglesCoverURL,
	)
	if err != nil {
		return nil, fmt.Errorf("scan order summary: %w", err)
	}
	s.ViewerIsSeller = o.SellerID == viewerID
	return &s, nil
}

// HandleListMine backs the Transactions tab (mobile + web) — every order
// the caller is a participant in, buyer or seller side, so both apps can
// render one merged list rather than stitching together separate "my
// purchases" and "my sales" order views.
func HandleListMine(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		orders, err := ListForUser(r.Context(), pool, callerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(orders)
	}
}
