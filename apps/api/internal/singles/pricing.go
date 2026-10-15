package singles

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/cardcatalog"
	"auctionhous-tcg/api/internal/catalog"
)

// Singles Shop pricing is standardized, never seller-set (explicit product
// decision): every copy of a card in the same condition/finish costs the
// same in every seller's shop, so bulk sells on whose card the buyer came
// for, not on who undercut by a cent.
//
// A single's price is its TCGplayer market price (via TCG Haven) rounded
// DOWN to the nearest step of PriceLadderCents — always at or under
// market, never over, except that anything under the first step is raised
// to it (the floor). Anything above the last step is capped there: a
// seller may choose to put a pricier card in their shop, but it sells at
// the cap (the Stock drawer warns them first). Moderately Played drops one
// more step. Keep in sync with SINGLES_PRICE_LADDER_CENTS in
// apps/web/lib/types.ts.
var PriceLadderCents = []int64{10, 25, 35, 50, 75, 100, 150, 200, 250, 350, 500}

// AllowedConditions are the conditions a single can be stocked in — no
// Heavily Played or Damaged: a 10¢ impulse add-on should never arrive
// beat up.
var AllowedConditions = []string{"Near Mint", "Lightly Played", "Moderately Played"}

const conditionOneStepDown = "Moderately Played"

// ErrNoMarketPrice: a single's price comes from the market price, so a
// card the catalog has no price for can't be stocked yet.
var ErrNoMarketPrice = errors.New("this card has no market price yet, so it can't be priced in the Singles Shop")

func ConditionAllowed(c string) bool {
	for _, a := range AllowedConditions {
		if a == c {
			return true
		}
	}
	return false
}

// MarketCents is the card's market price for the chosen finish, falling
// back to the other finish's price (the same rule TCG Haven's catalogPrice
// uses). 0 when the catalog has no price.
func MarketCents(card *cardcatalog.Card, isFoil bool) int64 {
	dollars := card.MarketPrice
	if isFoil {
		if card.MarketPriceFoil > 0 {
			dollars = card.MarketPriceFoil
		}
	} else if dollars <= 0 {
		dollars = card.MarketPriceFoil
	}
	return int64(math.Round(dollars * 100))
}

// LadderPriceCents maps a market price to the Singles Shop price for a
// condition: the highest ladder step <= market (the first step if market
// is below it), one step lower for Moderately Played (never below the
// first step).
func LadderPriceCents(marketCents int64, condition string) int64 {
	i := 0
	for j, step := range PriceLadderCents {
		if step <= marketCents {
			i = j
		}
	}
	if condition == conditionOneStepDown && i > 0 {
		i--
	}
	return PriceLadderCents[i]
}

// priceFor is the price of one variant of card, or ErrNoMarketPrice.
func priceFor(card *cardcatalog.Card, condition string, isFoil bool) (int64, error) {
	market := MarketCents(card, isFoil)
	if market <= 0 {
		return 0, ErrNoMarketPrice
	}
	return LadderPriceCents(market, condition), nil
}

// RepriceInterval is how often RunRepricer re-derives every single's price
// from the current market — a little slower than cardcatalog's own
// 2-minute snapshot cache, since a step change is rare.
const RepriceInterval = 5 * time.Minute

// Reprice re-derives every live single's price from the current catalog
// market price and writes back the ones whose step changed. Stored
// price_cents is a cache of this derivation, so every reader (checkout
// add-ons, Claim's compare-and-swap, order history) keeps reading one
// column. A card missing from the catalog, or with no market price right
// now, keeps its last price rather than being zeroed.
func Reprice(ctx context.Context, pool *pgxpool.Pool, cards *cardcatalog.Client) (int, error) {
	rows, err := pool.Query(ctx, `
		select id, game, catalog_card_id, condition, is_foil, price_cents
		from shop_singles where removed_at is null and game = any($1)
	`, catalog.EnabledGameNames())
	if err != nil {
		return 0, fmt.Errorf("query singles to reprice: %w", err)
	}
	type change struct {
		id    string
		price int64
	}
	var changes []change
	for rows.Next() {
		var (
			id, game, cardID, condition string
			isFoil                      bool
			current                     int64
		)
		if err := rows.Scan(&id, &game, &cardID, &condition, &isFoil, &current); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan single to reprice: %w", err)
		}
		card, err := cards.Lookup(ctx, game, cardID)
		if err != nil {
			continue
		}
		price, err := priceFor(card, condition, isFoil)
		if err != nil || price == current {
			continue
		}
		changes = append(changes, change{id, price})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, c := range changes {
		if _, err := pool.Exec(ctx, `
			update shop_singles set price_cents = $2, updated_at = now()
			where id = $1 and removed_at is null
		`, c.id, c.price); err != nil {
			return 0, fmt.Errorf("reprice single %s: %w", c.id, err)
		}
	}
	return len(changes), nil
}

// RunRepricer runs Reprice now and then every RepriceInterval until ctx is
// done. It lives in the API process (not cmd/worker) because that's where
// the catalog client is configured.
func RunRepricer(ctx context.Context, pool *pgxpool.Pool, cards *cardcatalog.Client) {
	tick := time.NewTicker(RepriceInterval)
	defer tick.Stop()
	for {
		n, err := Reprice(ctx, pool, cards)
		if err != nil {
			log.Printf("singles repricer: %v", err)
		} else if n > 0 {
			log.Printf("singles repricer: %d single(s) moved to a new price step", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
