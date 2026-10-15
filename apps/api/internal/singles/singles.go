// Package singles is the Singles Shop: a seller's stock of standardized,
// catalog-backed singles sold by quantity, alongside (not instead of) their
// photo listings. A single has no seller photos — it's a TCG Haven catalog
// card (internal/cardcatalog) plus a condition/foil variant, a price, and a
// quantity on hand, rendered with the catalog's standard card image.
//
// Singles are never bought standalone. They're added to an order at
// checkout ("Add Singles To Your Order", internal/auction's checkout
// add-ons) on top of a card the buyer already won or is buying from the
// same seller — the point is bundling multiple cards into one shipment.
//
// Stock is decremented only when a payment actually resolves (Claim, called
// from internal/auction.HandleBuyNow), with a compare-and-swap on
// quantity >= n, so two buyers can never both get the last copy.
package singles

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/cardcatalog"
	"auctionhous-tcg/api/internal/catalog"
)

var (
	ErrNotFound       = errors.New("single not found")
	ErrInvalidInput   = errors.New("invalid single")
	ErrGameNotEnabled = errors.New("the Singles Shop isn't open for this game yet")
	ErrCardNotFound   = errors.New("that card isn't in the catalog")
	// ErrNotEligible: the Singles Shop only takes Commons, Uncommons, and
	// Rares (cardcatalog.SinglesRarities) — chase prints are listings.
	ErrNotEligible = errors.New("only Commons, Uncommons, and Rares can go in the Singles Shop — sell Epics, Alt Arts, and Overnumbered cards as a regular listing")
	// ErrOutOfStock is returned by Claim when the seller no longer has
	// enough copies on hand (or the single was removed) — another buyer got
	// there first, or the seller edited their stock mid-checkout.
	ErrOutOfStock = errors.New("not enough of this single left in stock")
)

// maxQuantity caps a single row's stock — a sanity bound against typos
// (an extra zero), not a business limit anyone should hit in practice.
const maxQuantity = 9999

type Single struct {
	ID            string    `json:"id"`
	SellerID      string    `json:"sellerId"`
	Game          string    `json:"game"`
	CatalogCardID string    `json:"catalogCardId"`
	CardName      string    `json:"cardName"`
	SetName       string    `json:"setName"`
	CardNumber    string    `json:"cardNumber"`
	Rarity        *string   `json:"rarity,omitempty"`
	ImageURL      *string   `json:"imageUrl,omitempty"`
	Condition     string    `json:"condition"`
	IsFoil        bool      `json:"isFoil"`
	PriceCents    int64     `json:"priceCents"`
	Quantity      int       `json:"quantity"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

const selectColumns = `
	id, seller_id, game, catalog_card_id, card_name, set_name, card_number,
	rarity, image_url, condition, is_foil, price_cents, quantity, created_at, updated_at
`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSingle(row rowScanner) (*Single, error) {
	var s Single
	err := row.Scan(
		&s.ID, &s.SellerID, &s.Game, &s.CatalogCardID, &s.CardName, &s.SetName, &s.CardNumber,
		&s.Rarity, &s.ImageURL, &s.Condition, &s.IsFoil, &s.PriceCents, &s.Quantity, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &s, nil
}

// execer/querier are satisfied by both *pgxpool.Pool and pgx.Tx — Claim and
// Restock run inside internal/auction's checkout transaction.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type AddInput struct {
	Game          string `json:"game"`
	CatalogCardID string `json:"catalogCardId"`
	Condition     string `json:"condition"`
	IsFoil        bool   `json:"isFoil"`
	Quantity      int    `json:"quantity"`
}

// Add stocks a single in sellerID's shop. The card itself is resolved from
// the catalog server-side (cards.Lookup) — only its id ever comes from the
// client, so a shop can never show a name/image that isn't the real
// catalog card. The price is never the seller's: it's derived from the
// market price (pricing.go). Adding a variant (card + condition + foil)
// the seller already stocks merges into that row: the quantity is added on
// top and the price re-derived, rather than creating a second row for the
// identical item.
func Add(ctx context.Context, pool *pgxpool.Pool, cards *cardcatalog.Client, sellerID string, in AddInput) (*Single, error) {
	if !catalog.IsEnabledGame(in.Game) {
		return nil, ErrGameNotEnabled
	}
	if strings.TrimSpace(in.CatalogCardID) == "" || !ConditionAllowed(in.Condition) ||
		in.Quantity < 1 || in.Quantity > maxQuantity {
		return nil, ErrInvalidInput
	}

	card, err := cards.Lookup(ctx, in.Game, in.CatalogCardID)
	if err != nil {
		if errors.Is(err, cardcatalog.ErrCardNotFound) {
			return nil, ErrCardNotFound
		}
		return nil, fmt.Errorf("look up catalog card: %w", err)
	}
	if !card.SinglesEligible {
		return nil, ErrNotEligible
	}
	// A foil-only print (every Riftbound Rare) is always stocked as foil,
	// whatever the client sent — there's no Non-foil version to sell.
	if card.FoilOnly {
		in.IsFoil = true
	}
	price, err := priceFor(card, in.Condition, in.IsFoil)
	if err != nil {
		return nil, err
	}

	row := pool.QueryRow(ctx, `
		insert into shop_singles (
			seller_id, game, catalog_card_id, card_name, set_name, card_number,
			rarity, image_url, condition, is_foil, price_cents, quantity
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		on conflict (seller_id, catalog_card_id, condition, is_foil) where removed_at is null
		do update set
			quantity = least(shop_singles.quantity + excluded.quantity, `+fmt.Sprint(maxQuantity)+`),
			price_cents = excluded.price_cents,
			updated_at = now()
		returning `+selectColumns,
		sellerID, in.Game, card.ID, card.Name, card.SetName, printedNumber(card),
		nullIfEmpty(card.Rarity), nullIfEmpty(card.ImageURL), in.Condition, in.IsFoil, price, in.Quantity,
	)
	return scanSingle(row)
}

type UpdateInput struct {
	Quantity int `json:"quantity"`
}

// Update changes a single's quantity on hand — the only thing a seller
// controls after stocking it (the price is standardized, pricing.go).
// Quantity 0 is allowed — it keeps the row but hides it from buyers until
// restocked, unlike Remove.
func Update(ctx context.Context, pool *pgxpool.Pool, sellerID, id string, in UpdateInput) (*Single, error) {
	if in.Quantity < 0 || in.Quantity > maxQuantity {
		return nil, ErrInvalidInput
	}
	row := pool.QueryRow(ctx, `
		update shop_singles set quantity = $3, updated_at = now()
		where id = $1 and seller_id = $2 and removed_at is null
		returning `+selectColumns,
		id, sellerID, in.Quantity,
	)
	return scanSingle(row)
}

// Remove takes a single out of the seller's shop. Soft delete — past
// orders' order_addons rows keep referencing it.
func Remove(ctx context.Context, pool *pgxpool.Pool, sellerID, id string) error {
	tag, err := pool.Exec(ctx, `
		update shop_singles set removed_at = now(), updated_at = now()
		where id = $1 and seller_id = $2 and removed_at is null
	`, id, sellerID)
	if err != nil {
		return fmt.Errorf("remove single: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListForSeller returns sellerID's live singles, alphabetical by card name.
// inStockOnly is what buyers see (the checkout add-on picker, the public
// shop on a seller's profile); the seller's own management view passes
// false so sold-out rows stay visible to restock. Buyer-facing lists are
// also restricted to catalog.EnabledGames, same as listing browse.
func ListForSeller(ctx context.Context, pool *pgxpool.Pool, sellerID string, inStockOnly bool) ([]Single, error) {
	query := `select ` + selectColumns + ` from shop_singles where seller_id = $1 and removed_at is null`
	args := []any{sellerID}
	if inStockOnly {
		// Buyers only ever see eligible rarities and conditions, even if an
		// older row predates those rules (cardcatalog.SinglesRarities,
		// AllowedConditions).
		args = append(args, catalog.EnabledGameNames(), cardcatalog.SinglesRarities, AllowedConditions)
		query += ` and quantity > 0 and game = any($2) and rarity = any($3) and condition = any($4)`
	}
	query += ` order by card_name, set_name, card_number, condition`

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query singles: %w", err)
	}
	defer rows.Close()

	list := []Single{}
	for rows.Next() {
		s, err := scanSingle(rows)
		if err != nil {
			return nil, fmt.Errorf("scan single: %w", err)
		}
		list = append(list, *s)
	}
	return list, rows.Err()
}

// Get returns one live single, whether or not it's in stock.
func Get(ctx context.Context, pool *pgxpool.Pool, id string) (*Single, error) {
	return scanSingle(pool.QueryRow(ctx, `select `+selectColumns+` from shop_singles where id = $1 and removed_at is null`, id))
}

// Claim decrements qty copies of single id from sellerID's stock — the
// race-safe step of buying it (CLAUDE.md §5.3): a compare-and-swap on
// quantity >= qty, so two concurrent checkouts can never both take the
// last copy. unitPriceCents is the price the buyer's payment was
// authorized at; if the seller has repriced since, the claim fails rather
// than selling at a price neither side agreed to. Fails with ErrOutOfStock
// (never a partial claim) if there aren't enough left, the price moved, or
// the single was removed.
func Claim(ctx context.Context, db execer, sellerID, id string, qty int, unitPriceCents int64) error {
	tag, err := db.Exec(ctx, `
		update shop_singles set quantity = quantity - $3, updated_at = now()
		where id = $1 and seller_id = $2 and removed_at is null and quantity >= $3 and price_cents = $4
	`, id, sellerID, qty, unitPriceCents)
	if err != nil {
		return fmt.Errorf("claim single: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrOutOfStock
	}
	return nil
}

// Restock puts qty copies back — the undo for Claim when the rest of a
// checkout fails after stock was already taken, or when a paid order is
// cancelled/refunded. Deliberately not filtered on removed_at: a single the
// seller removed mid-checkout still gets its count corrected, it just stays
// hidden.
func Restock(ctx context.Context, db execer, id string, qty int) error {
	if _, err := db.Exec(ctx, `
		update shop_singles set quantity = least(quantity + $2, `+fmt.Sprint(maxQuantity)+`), updated_at = now()
		where id = $1
	`, id, qty); err != nil {
		return fmt.Errorf("restock single: %w", err)
	}
	return nil
}

// printedNumber is the collector number as printed on the card ("92a"),
// falling back to the catalog's bare number.
func printedNumber(card *cardcatalog.Card) string {
	if card.DisplayNumber != "" {
		return card.DisplayNumber
	}
	return card.Number
}

// RarityAllowed reports whether a stored single's rarity is one the
// Singles Shop sells — the buyer-side check for rows that predate the
// eligibility rule (new rows can't be added otherwise).
func RarityAllowed(rarity *string) bool {
	if rarity == nil {
		return false
	}
	for _, r := range cardcatalog.SinglesRarities {
		if r == *rarity {
			return true
		}
	}
	return false
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
