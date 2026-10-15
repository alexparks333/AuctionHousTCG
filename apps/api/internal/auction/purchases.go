package auction

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/platform"
)

// notAnAddon keeps a listing that was bought as a checkout add-on ("Add
// Singles To Your Order") out of Buy/Sold History as its own row — it's
// part of the bundle order and is counted in that order's main row
// (HistoryRow.Bundle*) instead, so its price isn't shown twice.
const notAnAddon = `not exists (
	select 1 from order_addons oa where oa.listing_id = l.id and oa.voided_at is null
)`

// HistoryRow is one Buy/Sold History row: the listing that was bought, plus
// whatever was bundled onto its order at checkout (Singles Shop singles
// and other Buy It Now listings). BundleCents is what those add-ons cost
// in total, so the row's price is the whole order's items, not just the
// main card.
type HistoryRow struct {
	listing.Listing
	BundleCardCount int   `json:"bundleCardCount"`
	BundleCents     int64 `json:"bundleCents"`
}

// withBundles orders listingsByID by listingIDs and attaches each one's
// bundle totals in one query.
func withBundles(ctx context.Context, pool *pgxpool.Pool, listingIDs []string, listingsByID map[string]listing.Listing) ([]HistoryRow, error) {
	type totals struct {
		count int
		cents int64
	}
	bundles := map[string]totals{}
	if len(listingIDs) > 0 {
		rows, err := pool.Query(ctx, `
			select oi.listing_id::text, sum(a.quantity)::int, sum(a.quantity * a.unit_price_cents)::bigint
			from order_items oi
			join order_addons a on a.order_id = oi.order_id and a.voided_at is null
			where oi.listing_id = any($1::uuid[])
			group by oi.listing_id
		`, listingIDs)
		if err != nil {
			return nil, fmt.Errorf("query bundles: %w", err)
		}
		for rows.Next() {
			var id string
			var t totals
			if err := rows.Scan(&id, &t.count, &t.cents); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan bundle: %w", err)
			}
			bundles[id] = t
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	out := make([]HistoryRow, 0, len(listingIDs))
	for _, id := range listingIDs {
		if lst, ok := listingsByID[id]; ok {
			b := bundles[id]
			out = append(out, HistoryRow{Listing: lst, BundleCardCount: b.count, BundleCents: b.cents})
		}
	}
	return out, nil
}

// MyPurchases returns every listing buyerID has actually bought — the real
// data behind the Buy History page. Two ways to end up owning a listing,
// unioned: winning an auction (bidding or Buy It Now, outcome in ('sold',
// 'bought_now') with buyerID as high_bidder_id) or buying a fixed-format
// listing outright (listing.buyer_id). Ordered newest purchase first.
//
// There's still no internal/order model wired in here yet (design doc v2
// §5), but each result's PaidAt (migration 0019) reflects a real fact:
// whether a Stripe charge actually captured for it, set by
// HandleBuyNow/PayForWonAuction at the moment that happens, never guessed or
// backfilled. The Buy History
// page shows a row as awaiting payment exactly when PaidAt is genuinely
// nil — a purchase made through the no-Stripe mock-payment path, or a
// plain auction win via bidding (no checkout step exists for that until
// the buyer visits Bids/Offers' "Awaiting Payment" action).
func MyPurchases(ctx context.Context, pool *pgxpool.Pool, buyerID string) ([]HistoryRow, error) {
	rows, err := pool.Query(ctx, `
		select l.id
		from listings l
		left join auctions a on a.listing_id = l.id
		where (l.buyer_id = $1
			or (a.high_bidder_id = $1 and a.outcome in ('sold', 'bought_now')))
			and `+notAnAddon+`
		order by coalesce(l.sold_at, a.closed_at) desc
	`, buyerID)
	if err != nil {
		return nil, fmt.Errorf("query my purchases: %w", err)
	}

	var listingIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan purchase: %w", err)
		}
		listingIDs = append(listingIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	listingsByID, err := listing.GetMany(ctx, pool, listingIDs)
	if err != nil {
		return nil, fmt.Errorf("get listings: %w", err)
	}

	// listingIDs is already in the right (newest-first) order; GetMany's
	// map doesn't preserve it, so rebuild the ordered slice from it rather
	// than ranging over the map.
	return withBundles(ctx, pool, listingIDs, listingsByID)
}

func HandleMyPurchases(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		buyerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		purchases, err := MyPurchases(r.Context(), pool, buyerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(purchases)
	}
}

// MySales is MyPurchases' mirror image — every listing sellerID has
// actually sold, newest first — the real data behind the Sold History
// page. Same two purchase shapes, just scoped by seller_id instead of
// buyer/high_bidder: an auction that closed with a winner, or a
// fixed-format listing with a buyer.
func MySales(ctx context.Context, pool *pgxpool.Pool, sellerID string) ([]HistoryRow, error) {
	rows, err := pool.Query(ctx, `
		select l.id
		from listings l
		left join auctions a on a.listing_id = l.id
		where l.seller_id = $1
			and (l.buyer_id is not null or a.outcome in ('sold', 'bought_now'))
			and `+notAnAddon+`
		order by coalesce(l.sold_at, a.closed_at) desc
	`, sellerID)
	if err != nil {
		return nil, fmt.Errorf("query my sales: %w", err)
	}

	var listingIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan sale: %w", err)
		}
		listingIDs = append(listingIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	listingsByID, err := listing.GetMany(ctx, pool, listingIDs)
	if err != nil {
		return nil, fmt.Errorf("get listings: %w", err)
	}

	return withBundles(ctx, pool, listingIDs, listingsByID)
}

func HandleMySales(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sellerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		sales, err := MySales(r.Context(), pool, sellerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sales)
	}
}
