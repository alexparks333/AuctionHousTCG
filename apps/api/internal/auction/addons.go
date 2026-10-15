package auction

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/catalog"
	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/singles"
)

// Checkout add-ons ("Add Singles To Your Order"): on top of the listing a
// buyer is paying for, they can add the same seller's Singles Shop singles
// (internal/singles) and other fixed-price listings, all in one payment,
// one order, one shipment.
//
// Lifecycle, and where the trust boundary sits:
//  1. HandleCreateCheckoutIntent resolves the buyer's requested add-ons
//     against the database (resolveAddons — prices are always read here,
//     never taken from the client), folds them into the PaymentIntent's
//     amount, and records exactly what was authorized in checkout_addons,
//     keyed by the PaymentIntent id.
//  2. HandleBuyNow reads those rows back by the verified PaymentIntent id
//     (loadCheckoutAddons) — the client never re-states what it's buying —
//     and claims them atomically (claimAddons) BEFORE the primary purchase,
//     so a sold-out single cancels the payment instead of charging for
//     something that can't ship. If the primary purchase then loses its
//     own race, the claims are undone (releaseAddons).
//  3. Once the order row exists, attachAddonsToOrder records them in
//     order_addons. order.ReleaseAddons restocks them if that order is
//     later cancelled/refunded.

// maxAddonLines bounds how many distinct add-on lines one checkout can carry
// — a sanity limit on request size, comfortably above any real bundle.
const maxAddonLines = 200

const (
	addonKindSingle  = "single"
	addonKindListing = "listing"
)

// AddonRequest is one line of the buyer's requested add-ons, as sent by the
// checkout page — only ever an id and a quantity; everything else is
// resolved server-side.
type AddonRequest struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	Quantity int    `json:"quantity"`
}

// checkoutAddon is one resolved, server-priced add-on line.
type checkoutAddon struct {
	Kind           string
	RefID          string
	Quantity       int
	UnitPriceCents int64
	Title          string
}

// AddonUnavailableError means one or more requested add-ons can't be
// bought right now — usually because another buyer's order took them
// first, or (rarely) the seller removed them or the market price moved
// the single to a new step. Items lists every one, labeled for the buyer
// ("Rengar (NM, Foil) — 1 left"), so they see the whole problem at once
// instead of fixing one card per failed attempt.
type AddonUnavailableError struct {
	Items []string
}

// soldOutPrefix is the exact wording the checkout shows (product decision).
const soldOutPrefix = "Sorry, someone bought these singles before you"

func (e *AddonUnavailableError) Error() string {
	if len(e.Items) == 0 {
		return soldOutPrefix + "."
	}
	return soldOutPrefix + ": " + strings.Join(e.Items, ", ")
}

// singleLabel is how a single is named in an AddonUnavailableError.
func singleLabel(name, condition string, isFoil bool, note string) string {
	finish := "Non-foil"
	if isFoil {
		finish = "Foil"
	}
	label := fmt.Sprintf("%s (%s, %s)", name, conditionShort(condition), finish)
	if note != "" {
		label += " — " + note
	}
	return label
}

func conditionShort(c string) string {
	switch c {
	case "Near Mint":
		return "NM"
	case "Lightly Played":
		return "LP"
	case "Moderately Played":
		return "MP"
	case "Heavily Played":
		return "HP"
	case "Damaged":
		return "DMG"
	}
	return c
}

// leftNote describes how many copies remain, for a buyer who asked for
// more than that.
func leftNote(left int) string {
	if left <= 0 {
		return "sold out"
	}
	return fmt.Sprintf("only %d left", left)
}

// describeSingleShortfall labels a single whose claim failed, from its
// current row — why it failed (sold out / not enough left / removed /
// price moved) decides the note.
func describeSingleShortfall(ctx context.Context, db pgx.Tx, id string, wantQty int, wantPrice int64) string {
	var (
		name, condition string
		isFoil, removed bool
		qty             int
		price           int64
	)
	err := db.QueryRow(ctx, `
		select card_name, condition, is_foil, quantity, price_cents, removed_at is not null
		from shop_singles where id = $1
	`, id).Scan(&name, &condition, &isFoil, &qty, &price, &removed)
	if err != nil {
		return "a single you added"
	}
	switch {
	case removed:
		return singleLabel(name, condition, isFoil, "no longer for sale")
	case qty < wantQty:
		return singleLabel(name, condition, isFoil, leftNote(qty))
	case price != wantPrice:
		return singleLabel(name, condition, isFoil, "price changed")
	}
	return singleLabel(name, condition, isFoil, "")
}

var errTooManyAddons = errors.New("too many add-ons in one order")

func addonsSubtotal(addons []checkoutAddon) int64 {
	var total int64
	for _, a := range addons {
		total += int64(a.Quantity) * a.UnitPriceCents
	}
	return total
}

func addonsCardCount(addons []checkoutAddon) int {
	n := 0
	for _, a := range addons {
		n += a.Quantity
	}
	return n
}

// resolveAddons validates the buyer's requested add-ons against the current
// database state and prices them. Duplicate lines for the same item are
// merged. Everything must belong to sellerID (the primary listing's seller
// — a bundle is one seller's shipment), be in stock / still for sale, and be
// in an enabled game. This is a courtesy check at authorization time; the
// race-safe guard is claimAddons when the payment actually resolves.
func resolveAddons(ctx context.Context, pool *pgxpool.Pool, sellerID, buyerID, primaryListingID string, reqs []AddonRequest) ([]checkoutAddon, error) {
	if len(reqs) == 0 {
		return nil, nil
	}
	if len(reqs) > maxAddonLines {
		return nil, errTooManyAddons
	}

	type key struct{ kind, id string }
	merged := map[key]int{}
	var order []key
	for _, r := range reqs {
		if r.Quantity <= 0 || r.ID == "" || (r.Kind != addonKindSingle && r.Kind != addonKindListing) {
			continue
		}
		k := key{r.Kind, r.ID}
		if _, seen := merged[k]; !seen {
			order = append(order, k)
		}
		merged[k] += r.Quantity
	}

	addons := make([]checkoutAddon, 0, len(order))
	var unavailable []string
	for _, k := range order {
		qty := merged[k]
		switch k.kind {
		case addonKindSingle:
			s, err := singles.Get(ctx, pool, k.id)
			if err != nil {
				if errors.Is(err, singles.ErrNotFound) {
					unavailable = append(unavailable, "a single that's no longer for sale")
					continue
				}
				return nil, err
			}
			if s.SellerID != sellerID || !catalog.IsEnabledGame(s.Game) || !singles.RarityAllowed(s.Rarity) ||
				!singles.ConditionAllowed(s.Condition) {
				unavailable = append(unavailable, singleLabel(s.CardName, s.Condition, s.IsFoil, "no longer for sale"))
				continue
			}
			if s.Quantity < qty {
				unavailable = append(unavailable, singleLabel(s.CardName, s.Condition, s.IsFoil, leftNote(s.Quantity)))
				continue
			}
			addons = append(addons, checkoutAddon{
				Kind: addonKindSingle, RefID: s.ID, Quantity: qty, UnitPriceCents: s.PriceCents, Title: s.CardName,
			})

		case addonKindListing:
			var (
				title      string
				lSellerID  string
				format     string
				status     string
				buyer      *string
				priceCents *int64
				game       string
			)
			err := pool.QueryRow(ctx, `
				select title, seller_id, format, status, buyer_id, price_cents, game
				from listings where id = $1
			`, k.id).Scan(&title, &lSellerID, &format, &status, &buyer, &priceCents, &game)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					unavailable = append(unavailable, "a listing that's no longer for sale")
					continue
				}
				return nil, err
			}
			if k.id == primaryListingID || lSellerID != sellerID || lSellerID == buyerID ||
				format != "fixed" || status != "active" || buyer != nil ||
				priceCents == nil || *priceCents <= 0 || !catalog.IsEnabledGame(game) {
				unavailable = append(unavailable, title+" — sold")
				continue
			}
			addons = append(addons, checkoutAddon{
				Kind: addonKindListing, RefID: k.id, Quantity: 1, UnitPriceCents: *priceCents, Title: title,
			})
		}
	}
	if len(unavailable) > 0 {
		return nil, &AddonUnavailableError{Items: unavailable}
	}
	return addons, nil
}

// saveCheckoutAddons records what paymentIntentID authorized beyond the
// primary listing. No-op for an empty list — a plain single-card checkout
// writes nothing.
func saveCheckoutAddons(ctx context.Context, pool *pgxpool.Pool, paymentIntentID string, addons []checkoutAddon) error {
	if len(addons) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, a := range addons {
		batch.Queue(`
			insert into checkout_addons (payment_intent_id, kind, ref_id, quantity, unit_price_cents)
			values ($1, $2, $3, $4, $5)
			on conflict (payment_intent_id, kind, ref_id) do nothing
		`, paymentIntentID, a.Kind, a.RefID, a.Quantity, a.UnitPriceCents)
	}
	return pool.SendBatch(ctx, batch).Close()
}

// loadCheckoutAddons reads back what paymentIntentID authorized. Titles are
// joined in only for error messages.
func loadCheckoutAddons(ctx context.Context, pool *pgxpool.Pool, paymentIntentID string) ([]checkoutAddon, error) {
	rows, err := pool.Query(ctx, `
		select ca.kind, ca.ref_id, ca.quantity, ca.unit_price_cents,
			coalesce(s.card_name, l.title, '')
		from checkout_addons ca
		left join shop_singles s on ca.kind = 'single' and s.id = ca.ref_id
		left join listings l on ca.kind = 'listing' and l.id = ca.ref_id
		where ca.payment_intent_id = $1
		order by ca.created_at, ca.kind, ca.ref_id
	`, paymentIntentID)
	if err != nil {
		return nil, fmt.Errorf("load checkout add-ons: %w", err)
	}
	defer rows.Close()
	var addons []checkoutAddon
	for rows.Next() {
		var a checkoutAddon
		if err := rows.Scan(&a.Kind, &a.RefID, &a.Quantity, &a.UnitPriceCents, &a.Title); err != nil {
			return nil, fmt.Errorf("scan checkout add-on: %w", err)
		}
		addons = append(addons, a)
	}
	return addons, rows.Err()
}

// claimAddons takes every add-on off the market in one transaction — all or
// nothing. Singles are decremented with a compare-and-swap on stock and
// price (singles.Claim); add-on listings get the same compare-and-swap on
// status = 'active' that listing.BuyNowFixed uses, plus a price check, and
// the same bought/sold notifications. Committed before the primary
// purchase runs (see this file's top comment), and undone by releaseAddons
// if that purchase then fails.
func claimAddons(ctx context.Context, pool *pgxpool.Pool, sellerID, buyerID string, addons []checkoutAddon) error {
	if len(addons) == 0 {
		return nil
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Every line is attempted even after one fails, so the buyer is told
	// about all of them at once; any failure rolls the whole claim back.
	var unavailable []string
	for _, a := range addons {
		switch a.Kind {
		case addonKindSingle:
			if err := singles.Claim(ctx, tx, sellerID, a.RefID, a.Quantity, a.UnitPriceCents); err != nil {
				if errors.Is(err, singles.ErrOutOfStock) {
					unavailable = append(unavailable, describeSingleShortfall(ctx, tx, a.RefID, a.Quantity, a.UnitPriceCents))
					continue
				}
				return err
			}
		case addonKindListing:
			tag, err := tx.Exec(ctx, `
				update listings set status = 'ended', buyer_id = $1, sold_at = now()
				where id = $2 and seller_id = $3 and format = 'fixed' and status = 'active'
					and buyer_id is null and price_cents = $4
			`, buyerID, a.RefID, sellerID, a.UnitPriceCents)
			if err != nil {
				return fmt.Errorf("claim add-on listing: %w", err)
			}
			if tag.RowsAffected() == 0 {
				unavailable = append(unavailable, a.Title+" — sold")
				continue
			}
			if err := notification.Create(ctx, tx, buyerID, notification.KindBought, a.RefID); err != nil {
				return fmt.Errorf("notify bought: %w", err)
			}
			if err := notification.Create(ctx, tx, sellerID, notification.KindSold, a.RefID); err != nil {
				return fmt.Errorf("notify sold: %w", err)
			}
		}
	}
	if len(unavailable) > 0 {
		return &AddonUnavailableError{Items: unavailable}
	}
	return tx.Commit(ctx)
}

// releaseAddons undoes claimAddons when the primary purchase fails after the
// add-ons were already claimed: singles are restocked, add-on listings go
// back on sale. Best-effort and logged — it runs on an already-failing path.
func releaseAddons(ctx context.Context, pool *pgxpool.Pool, buyerID string, addons []checkoutAddon) {
	for _, a := range addons {
		switch a.Kind {
		case addonKindSingle:
			if err := singles.Restock(ctx, pool, a.RefID, a.Quantity); err != nil {
				log.Printf("checkout add-ons: failed to restock single %s: %v", a.RefID, err)
			}
		case addonKindListing:
			if _, err := pool.Exec(ctx, `
				update listings set status = 'active', buyer_id = null, sold_at = null
				where id = $1 and buyer_id = $2 and paid_at is null
			`, a.RefID, buyerID); err != nil {
				log.Printf("checkout add-ons: failed to release listing %s: %v", a.RefID, err)
			}
		}
	}
}

// attachAddonsToOrder records the claimed add-ons on the order they were
// paid for. markPaid mirrors the primary listing's own paid_at stamp onto
// add-on listings (card rail; ACH's is set when the debit clears).
func attachAddonsToOrder(ctx context.Context, pool *pgxpool.Pool, orderID string, addons []checkoutAddon, markPaid bool) error {
	if len(addons) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, a := range addons {
		if a.Kind == addonKindSingle {
			batch.Queue(`
				insert into order_addons (order_id, shop_single_id, quantity, unit_price_cents)
				values ($1, $2, $3, $4)
			`, orderID, a.RefID, a.Quantity, a.UnitPriceCents)
		} else {
			batch.Queue(`
				insert into order_addons (order_id, listing_id, quantity, unit_price_cents)
				values ($1, $2, 1, $3)
			`, orderID, a.RefID, a.UnitPriceCents)
			if markPaid {
				batch.Queue(`update listings set paid_at = now() where id = $1 and paid_at is null`, a.RefID)
			}
		}
	}
	return pool.SendBatch(ctx, batch).Close()
}
