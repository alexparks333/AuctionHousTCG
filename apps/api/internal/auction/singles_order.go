package auction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/catalog"
	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/seller"
	"auctionhous-tcg/api/internal/shipping"
	"auctionhous-tcg/api/internal/user"
)

// Singles-only orders: buying a seller's Singles Shop singles on their own,
// with no listed card to add them to.
//
// Every order surface (order_items, the /listings/{id}/order/* routes,
// labels, tracking, claims, reviews, Buy/Sold History, worker timers) is
// keyed on one primary listing, so a singles-only purchase gets a hidden
// "container" listing (listing.Listing.SinglesOrder, migration 0067) and
// goes through the exact same checkout as any other purchase:
//  1. POST /users/{username}/singles-order opens (or reuses) the buyer's
//     container for that seller and returns its id; the buyer lands on
//     /checkout/{id}.
//  2. HandleCreateCheckoutIntent prices the cart as add-ons on top of a $0
//     primary item (resolveAddons), enforcing MinSinglesOrderCents and the
//     singles shipping rule (shipping.SinglesOrderPreset).
//  3. HandleBuyNow claims the singles (claimAddons), then paySinglesOrder
//     marks the container bought, and createOrderRecord builds the order —
//     from there it's an ordinary order.

// MinSinglesOrderCents is the smallest singles-only order (product
// decision): below it, postage and the per-order fee eat the whole sale.
// Singles added to a card's checkout have no minimum. Mirrored as
// MIN_SINGLES_ORDER_CENTS in apps/web/lib/types.ts.
const MinSinglesOrderCents int64 = 250

var (
	errSinglesOrderNotYours = errors.New("this singles order isn't yours")
	errSinglesOrderEmpty    = errors.New("add at least one single to check out")
	errSinglesOrderOnly     = errors.New("a singles-only order can only contain Singles Shop singles")
)

// singlesBelowMinimumError is a cart under MinSinglesOrderCents.
type singlesBelowMinimumError struct {
	subtotalCents int64
}

func (e *singlesBelowMinimumError) Error() string {
	return fmt.Sprintf("Singles-only orders need at least %s of singles — add %s more.",
		dollars(MinSinglesOrderCents), dollars(MinSinglesOrderCents-e.subtotalCents))
}

func dollars(cents int64) string {
	return fmt.Sprintf("$%d.%02d", cents/100, cents%100)
}

// checkSinglesCart validates a singles-only cart: only singles, at least
// one, and at least MinSinglesOrderCents in total.
func checkSinglesCart(addons []checkoutAddon) error {
	if len(addons) == 0 {
		return errSinglesOrderEmpty
	}
	for _, a := range addons {
		if a.Kind != addonKindSingle {
			return errSinglesOrderOnly
		}
	}
	if subtotal := addonsSubtotal(addons); subtotal < MinSinglesOrderCents {
		return &singlesBelowMinimumError{subtotalCents: subtotal}
	}
	return nil
}

// singlesCartStatus maps checkSinglesCart's errors to HTTP statuses.
func singlesCartStatus(err error) int {
	var below *singlesBelowMinimumError
	if errors.As(err, &below) || errors.Is(err, errSinglesOrderEmpty) || errors.Is(err, errSinglesOrderOnly) {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

// orderCardCount is every card in the shipment: the primary card (none for
// a singles-only order's container) plus every add-on copy.
func orderCardCount(lst *listing.Listing, addons []checkoutAddon) int {
	n := addonsCardCount(addons)
	if !lst.SinglesOrder {
		n++
	}
	return n
}

// resolveOrderShipping is what an order ships as, computed identically at
// checkout-intent time and at order creation. A normal purchase starts from
// the listing's own preset (UpgradePreset, then UpgradeForItemCount); a
// singles-only order ignores the container's preset and uses the singles
// rule (SinglesOrderPreset), with the same value-based upgrade on top.
func resolveOrderShipping(lst *listing.Listing, subtotalCents int64, cardCount int) (shipping.Preset, bool) {
	if lst.SinglesOrder {
		return shipping.UpgradePreset(shipping.SinglesOrderPreset(cardCount), subtotalCents, false)
	}
	preset, signatureRequired := shipping.UpgradePreset(shipping.Preset(lst.ShippingPreset), subtotalCents, lst.RequestSignature)
	return shipping.UpgradeForItemCount(preset, cardCount), signatureRequired
}

// singlesOrderErrStatus maps checkSinglesOrderBuyer/paySinglesOrder errors
// to HTTP statuses (409 is what the checkout page reads as "already bought").
func singlesOrderErrStatus(err error) int {
	switch {
	case errors.Is(err, listing.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, errSinglesOrderNotYours), errors.Is(err, ErrAccountSuspended), errors.Is(err, ErrListingSuspended):
		return http.StatusForbidden
	case errors.Is(err, ErrAlreadyPaid):
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}

// singlesOrderReservedFor is who a container was opened for.
func singlesOrderReservedFor(ctx context.Context, pool *pgxpool.Pool, listingID string) (string, error) {
	var reserved *string
	if err := pool.QueryRow(ctx, `select reserved_buyer_id from listings where id = $1 and singles_order`, listingID).Scan(&reserved); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", listing.ErrNotFound
		}
		return "", fmt.Errorf("read singles order: %w", err)
	}
	if reserved == nil {
		return "", nil
	}
	return *reserved, nil
}

// checkSinglesOrderBuyer refuses a container opened for someone else, or
// one that's already been paid for.
func checkSinglesOrderBuyer(ctx context.Context, pool *pgxpool.Pool, lst *listing.Listing, buyerID string) error {
	reserved, err := singlesOrderReservedFor(ctx, pool, lst.ID)
	if err != nil {
		return err
	}
	if reserved != buyerID {
		return errSinglesOrderNotYours
	}
	if lst.BuyerID != nil {
		return ErrAlreadyPaid
	}
	return nil
}

// openSinglesOrder returns the buyer's open container for sellerID,
// creating it if there isn't one. Reused across visits, so abandoned carts
// leave at most one row per buyer and seller (listings_open_singles_order_idx).
func openSinglesOrder(ctx context.Context, pool *pgxpool.Pool, sellerID, sellerName, buyerID string) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		insert into listings (
			seller_id, title, game, set_name, condition, format, status, image_urls,
			shipping_preset, singles_order, reserved_buyer_id
		) values ($1, $2, $3, 'Singles Shop', 'Mixed', 'fixed', 'ended', '{}', 'tracked_envelope', true, $4)
		on conflict (seller_id, reserved_buyer_id) where singles_order and buyer_id is null do nothing
		returning id
	`, sellerID, "Singles from "+sellerName, string(catalog.EnabledGames[0]), buyerID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("open singles order: %w", err)
	}
	// Already open — conflict, so nothing was inserted.
	err = pool.QueryRow(ctx, `
		select id from listings
		where seller_id = $1 and reserved_buyer_id = $2 and singles_order and buyer_id is null
	`, sellerID, buyerID).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("find open singles order: %w", err)
	}
	return id, nil
}

// HandleStartSinglesOrder backs the seller profile's "Check out" in their
// Singles Shop: POST /users/{username}/singles-order -> {listingId}. Only
// opens the container — the cart itself rides to the checkout page and is
// priced there, the same as add-ons.
func HandleStartSinglesOrder(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		buyerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		sellerUser, err := user.GetByUsername(r.Context(), pool, r.PathValue("username"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, user.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		if sellerUser.ID == buyerID {
			http.Error(w, "you can't buy from your own Singles Shop", http.StatusForbidden)
			return
		}
		if sellerUser.IsBanned {
			http.Error(w, listing.ErrListingSuspended.Error(), http.StatusForbidden)
			return
		}
		stripeAccountID, err := seller.RequirePayoutsEnabled(r.Context(), pool, sellerUser.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if stripeAccountID == "" {
			http.Error(w, ErrSellerNotOnboarded.Error(), http.StatusPreconditionFailed)
			return
		}
		name := ""
		if sellerUser.Username != nil {
			name = *sellerUser.Username
		}
		id, err := openSinglesOrder(r.Context(), pool, sellerUser.ID, name, buyerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"listingId": id})
	}
}

// paySinglesOrder is a singles-only order's purchase step — the container's
// equivalent of listing.BuyNowFixed: a compare-and-swap on buyer_id being
// null (two tabs paying the same cart can't both win), the same suspension
// checks, and the same bought/sold notifications. The title is set to the
// final card count here, since the cart can change right up to payment.
func paySinglesOrder(ctx context.Context, pool *pgxpool.Pool, listingID, buyerID string, addons []checkoutAddon) (*listing.Listing, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var sellerID string
	var reserved *string
	err = tx.QueryRow(ctx, `
		select seller_id, reserved_buyer_id from listings where id = $1 and singles_order for update
	`, listingID).Scan(&sellerID, &reserved)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, listing.ErrNotFound
		}
		return nil, fmt.Errorf("read singles order: %w", err)
	}
	if reserved == nil || *reserved != buyerID {
		return nil, errSinglesOrderNotYours
	}

	var buyerSuspended, sellerSuspended bool
	if err := tx.QueryRow(ctx, `
		select
			exists(select 1 from account_suspensions where user_id = $1 and now() < ends_at),
			exists(select 1 from account_suspensions where user_id = $2 and now() < ends_at)
	`, buyerID, sellerID).Scan(&buyerSuspended, &sellerSuspended); err != nil {
		return nil, fmt.Errorf("check suspension status: %w", err)
	}
	if buyerSuspended {
		return nil, ErrAccountSuspended
	}
	if sellerSuspended {
		return nil, ErrListingSuspended
	}

	cards := addonsCardCount(addons)
	noun := "cards"
	if cards == 1 {
		noun = "card"
	}
	tag, err := tx.Exec(ctx, `
		update listings set buyer_id = $1, sold_at = now(), title = $2
		where id = $3 and singles_order and buyer_id is null
	`, buyerID, fmt.Sprintf("Singles order · %d %s", cards, noun), listingID)
	if err != nil {
		return nil, fmt.Errorf("update singles order: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAlreadyPaid
	}

	if err := notification.Create(ctx, tx, buyerID, notification.KindBought, listingID); err != nil {
		return nil, fmt.Errorf("notify bought: %w", err)
	}
	if err := notification.Create(ctx, tx, sellerID, notification.KindSold, listingID); err != nil {
		return nil, fmt.Errorf("notify sold: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return listing.Get(ctx, pool, listingID)
}
