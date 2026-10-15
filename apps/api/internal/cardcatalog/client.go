package cardcatalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

// staleAfter mirrors TCG Haven's own STALE_MS (lib/api/catalog.ts) — how
// long a warm in-memory cache is trusted before re-reading the snapshot.
// This package always does a full snapshot re-read on expiry rather than
// TCG Haven's finer-grained updatedAt delta-pull: it's a secondary,
// read-only consumer (a handful of chunk-doc reads either way), so the
// simpler strategy is enough and avoids depending on exactly how TCG
// Haven serializes Firestore Timestamps inside the snapshot's JSON blob.
const staleAfter = 2 * time.Minute

// Card is the subset of fields common across TCG Haven's three per-game
// schemas (see that project's catalog doc §3) — enough to autofill
// AuctionHous's Sell wizard. Game-specific fields (marketPrice, publicCode,
// cardType, ...) are intentionally not decoded; this package only ever
// reads, never re-derives pricing or variant logic that isn't ours to own.
type Card struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Set     string `json:"set"`
	SetName string `json:"setName"`
	Number  string `json:"number"`
	Rarity  string `json:"rarity"`
	// Game is the AuctionHous game name (catalog.Game — "Pokémon", not TCG
	// Haven's "pokemon" slug), stamped onto every result by Search/SearchAll
	// rather than left for the caller to infer. Search already knows which
	// game it was asked about; SearchAll needs it on the Card itself since
	// its results are merged across all three catalog-backed games — the
	// Favorite Card widget picker (unlike the Sell wizard's per-game
	// CardSearch) has no single game context to fall back on, so this is
	// what lets a picked card round-trip back through ProfileWidget without
	// a second lookup.
	Game     string   `json:"game"`
	ImageURL string   `json:"imageUrl"`
	Tags     []string `json:"tags"` // Riftbound only; nil for the other games
	Hidden   bool     `json:"hidden"`
	// SetCode/PublicCode/CardType are Riftbound's set code ("SFD"), printed
	// collector code ("SFD-092a/221"), and card type ("Battlefield", ...).
	SetCode    string `json:"setCode,omitempty"`
	PublicCode string `json:"publicCode,omitempty"`
	CardType   string `json:"cardType,omitempty"`
	// MarketPrice/MarketPriceFoil are TCG Haven's synced TCGplayer market
	// prices in dollars (0 = unknown) — read-only reference shown to sellers
	// and used to suggest a Singles Shop price, never used to charge anyone.
	MarketPrice     float64 `json:"marketPrice"`
	MarketPriceFoil float64 `json:"marketPriceFoil"`
	// DisplayNumber is the collector number as printed ("92a", "SP6"),
	// computed at load time (displayNumber) — Number alone is the bare digit
	// for Riftbound alt arts, indistinguishable from the base card.
	DisplayNumber string `json:"displayNumber"`
	// SinglesEligible is whether this card may be stocked in a Singles Shop
	// (singlesEligible) — computed at load time so the API is the one place
	// the rule lives; the frontend only reads the flag.
	SinglesEligible bool `json:"singlesEligible"`
	// FoilOnly is whether this card only exists as a foil (foilOnly), so a
	// Singles Shop sells it as one finish instead of Non-foil + Foil.
	FoilOnly bool `json:"foilOnly"`
}

type cacheEntry struct {
	cards     []Card
	fetchedAt time.Time
}

// Client is a read-only handle onto TCG Haven's Firestore catalog. Safe for
// concurrent use — Search is called from every incoming HTTP request.
type Client struct {
	fs *firestore.Client

	mu    sync.RWMutex
	cache map[string]cacheEntry // keyed by TCG Haven game slug

	registryMu      sync.RWMutex
	registry        map[string]any // TCG Haven's registry/main doc
	registryFetched time.Time
}

// NewClient dials TCG Haven's Firestore project using a service account
// key file (see apps/api/.env.example for how to provision one scoped to
// roles/datastore.viewer). Returns an error if the project/credentials are
// unreachable — callers should treat that as "feature unavailable," the
// same graceful-degradation pattern as a missing SUPABASE_URL.
func NewClient(ctx context.Context, projectID, credentialsFile string) (*Client, error) {
	fs, err := firestore.NewClient(ctx, projectID, option.WithCredentialsFile(credentialsFile))
	if err != nil {
		return nil, fmt.Errorf("cardcatalog: connecting to firestore: %w", err)
	}
	return &Client{fs: fs, cache: make(map[string]cacheEntry)}, nil
}

func (c *Client) Close() error {
	return c.fs.Close()
}

// loadSnapshot reads catalog_snapshot/{game}/chunks/* — TCG Haven's own
// pre-sharded full-catalog snapshot (each chunk's `cards` field is a
// JSON-stringified array, chosen by that project to stay under Firestore's
// 1MiB per-document limit). This is a handful of document reads regardless
// of catalog size, the same cold-start path TCG Haven's own server uses.
func (c *Client) loadSnapshot(ctx context.Context, gameSlug string) ([]Card, error) {
	iter := c.fs.Collection("catalog_snapshot").Doc(gameSlug).Collection("chunks").Documents(ctx)
	defer iter.Stop()

	var cards []Card
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("cardcatalog: reading snapshot chunks for %s: %w", gameSlug, err)
		}
		raw, ok := doc.Data()["cards"].(string)
		if !ok || raw == "" {
			continue
		}
		var chunk []Card
		if err := json.Unmarshal([]byte(raw), &chunk); err != nil {
			// A malformed chunk shouldn't take down the whole catalog for
			// every other game/chunk — log and skip it.
			log.Printf("cardcatalog: skipping unparseable snapshot chunk %s/%s: %v", gameSlug, doc.Ref.ID, err)
			continue
		}
		for i := range chunk {
			chunk[i].DisplayNumber = displayNumber(chunk[i].Number, chunk[i].PublicCode)
			chunk[i].SinglesEligible = singlesEligible(chunk[i].Rarity, chunk[i].PublicCode)
			chunk[i].FoilOnly = foilOnly(gameSlug, chunk[i].Rarity)
		}
		cards = append(cards, chunk...)
	}
	return cards, nil
}

// visibleCards returns the cached, non-hidden card list for one TCG Haven
// game slug, refreshing from Firestore if the cache is cold or stale.
func (c *Client) visibleCards(ctx context.Context, gameSlug string) ([]Card, error) {
	c.mu.RLock()
	entry, ok := c.cache[gameSlug]
	c.mu.RUnlock()

	if ok && time.Since(entry.fetchedAt) < staleAfter {
		return entry.cards, nil
	}

	cards, err := c.loadSnapshot(ctx, gameSlug)
	if err != nil {
		if ok {
			// Firestore hiccup on a background refresh — serve the last
			// good snapshot rather than failing the request outright.
			return entry.cards, nil
		}
		return nil, err
	}

	visible := make([]Card, 0, len(cards))
	for _, card := range cards {
		if !card.Hidden {
			visible = append(visible, card)
		}
	}

	c.mu.Lock()
	c.cache[gameSlug] = cacheEntry{cards: visible, fetchedAt: time.Now()}
	c.mu.Unlock()

	return visible, nil
}

// ErrCardNotFound is returned by Lookup when no visible card with that id
// exists in the game's catalog (or the game isn't catalog-backed/enabled).
var ErrCardNotFound = errors.New("cardcatalog: card not found")

// Lookup returns one card by its TCG Haven id within an AuctionHous game —
// the server-side source of truth for anything that stores a catalog card
// reference (internal/singles), so a card's name/set/number/image are
// always resolved from the catalog itself, never trusted from a client.
func (c *Client) Lookup(ctx context.Context, auctionHousGame, cardID string) (*Card, error) {
	slug, ok := gameSlug(auctionHousGame)
	if !ok {
		return nil, ErrCardNotFound
	}
	cards, err := c.visibleCards(ctx, slug)
	if err != nil {
		return nil, err
	}
	for _, card := range cards {
		if card.ID == cardID {
			card.Game = auctionHousGame
			return &card, nil
		}
	}
	return nil, ErrCardNotFound
}
