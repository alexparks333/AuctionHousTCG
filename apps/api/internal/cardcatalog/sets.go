package cardcatalog

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SetInfo is one set as the Singles Shop's set picker shows it — mirrors
// what TCG Haven's own Cardex picker reads from its set registry.
type SetInfo struct {
	Name        string `json:"name"`
	Label       string `json:"label"` // display name; Name unless the registry overrides it
	Code        string `json:"code,omitempty"`
	ReleaseDate string `json:"releaseDate,omitempty"`
	CardCount   int    `json:"cardCount"` // visible catalog cards, counted live
	// SinglesCount is how many of those can go in a Singles Shop
	// (Card.SinglesEligible) — 0 for a set of nothing but chase prints.
	SinglesCount int `json:"singlesCount"`
}

// SetGroup is one heading in the set picker ("Main Sets", "Promos", ...).
type SetGroup struct {
	Label string    `json:"label"`
	Sets  []SetInfo `json:"sets"`
}

// loadRegistry reads TCG Haven's registry/main doc — the set list and
// Cardex grouping its own Admin Catalog maintains — cached for staleAfter,
// same as the card snapshot. A fixed document path, like every other read
// in this package (see doc.go's trust-boundary note).
func (c *Client) loadRegistry(ctx context.Context) (map[string]any, error) {
	c.registryMu.RLock()
	reg, fetched := c.registry, c.registryFetched
	c.registryMu.RUnlock()
	if reg != nil && time.Since(fetched) < staleAfter {
		return reg, nil
	}
	snap, err := c.fs.Collection("registry").Doc("main").Get(ctx)
	if err != nil {
		if reg != nil {
			return reg, nil // serve the last good copy over failing outright
		}
		return nil, fmt.Errorf("cardcatalog: reading set registry: %w", err)
	}
	reg = snap.Data()
	c.registryMu.Lock()
	c.registry, c.registryFetched = reg, time.Now()
	c.registryMu.Unlock()
	return reg, nil
}

// Sets returns an AuctionHous game's sets grouped the way TCG Haven's
// Cardex groups them: the registry's groupOrder, each group's sets in
// registry order, any extra registry groups after those. Counts come from
// the live visible snapshot, so a set the registry lists but that has no
// visible cards yet is left out, and a snapshot set the registry doesn't
// know about lands in a trailing "Other" group rather than disappearing.
// A game whose registry entry has no grouping (Pokémon) gets one "All
// sets" group, newest first. Returns nil for a game with no catalog.
func (c *Client) Sets(ctx context.Context, auctionHousGame string) ([]SetGroup, error) {
	slug, ok := gameSlug(auctionHousGame)
	if !ok {
		return nil, nil
	}
	cards, err := c.visibleCards(ctx, slug)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	singlesCounts := map[string]int{}
	codes := map[string]string{}
	for _, card := range cards {
		counts[card.SetName]++
		if card.SinglesEligible {
			singlesCounts[card.SetName]++
		}
		if codes[card.SetName] == "" {
			codes[card.SetName] = card.SetCode
		}
	}

	reg, err := c.loadRegistry(ctx)
	if err != nil {
		return nil, err
	}
	side, _ := reg[slug].(map[string]any)
	regSets, _ := side["sets"].([]any)

	var order []string
	byGroup := map[string][]SetInfo{}
	addTo := func(group string, info SetInfo) {
		if _, seen := byGroup[group]; !seen {
			order = append(order, group)
		}
		byGroup[group] = append(byGroup[group], info)
	}
	if groupOrder, ok := side["groupOrder"].([]any); ok {
		for _, g := range groupOrder {
			if label, ok := g.(string); ok {
				order = append(order, label)
				byGroup[label] = nil
			}
		}
	}

	placed := map[string]bool{}
	for _, raw := range regSets {
		m, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := str(m["setName"])
		if name == "" || counts[name] == 0 || placed[name] {
			continue
		}
		placed[name] = true
		group := str(m["cardexGroup"])
		if group == "" {
			group = "All sets"
		}
		label := str(m["cardexLabel"])
		if label == "" {
			label = name
		}
		code := str(m["setCode"])
		if code == "" {
			code = str(m["code"])
		}
		if code == "" {
			code = codes[name]
		}
		addTo(group, SetInfo{Name: name, Label: label, Code: code, ReleaseDate: str(m["releaseDate"]), CardCount: counts[name], SinglesCount: singlesCounts[name]})
	}

	var leftovers []string
	for name := range counts {
		if !placed[name] {
			leftovers = append(leftovers, name)
		}
	}
	sort.Strings(leftovers)
	for _, name := range leftovers {
		addTo("Other", SetInfo{Name: name, Label: name, Code: codes[name], CardCount: counts[name], SinglesCount: singlesCounts[name]})
	}

	groups := make([]SetGroup, 0, len(order))
	for _, label := range order {
		sets := byGroup[label]
		if len(sets) == 0 {
			continue
		}
		if label == "All sets" {
			sort.SliceStable(sets, func(i, j int) bool { return sets[i].ReleaseDate > sets[j].ReleaseDate })
		}
		groups = append(groups, SetGroup{Label: label, Sets: sets})
	}
	return groups, nil
}

// CardsInSet returns one set's visible cards in Cardex order (sortCards).
func (c *Client) CardsInSet(ctx context.Context, auctionHousGame, setName string) ([]Card, error) {
	slug, ok := gameSlug(auctionHousGame)
	if !ok {
		return nil, nil
	}
	cards, err := c.visibleCards(ctx, slug)
	if err != nil {
		return nil, err
	}
	var out []Card
	for _, card := range cards {
		if card.SetName == setName {
			card.Game = auctionHousGame
			out = append(out, card)
		}
	}
	sortCards(out)
	return out, nil
}

// rarityOrder is the Riftbound/Lorcana slice of TCG Haven's
// CARDEX_RARITY_ORDER (lib/api/catalog.ts) — same-number variants sort by
// it; anything unlisted sorts after (50), matching that file's fallback.
var rarityOrder = map[string]int{
	"Common": 0, "Uncommon": 1, "Rare": 2, "Super_rare": 3, "Legendary": 4,
	"Enchanted": 5, "Epic": 6, "Iconic": 7, "Promo": 8,
}

// sortCards is a port of TCG Haven's sortCatalogCards: numeric collector
// numbers ascending (ties broken by rarity), non-numeric ones (Riftbound
// "R01" runes) after, alphabetically.
func sortCards(cards []Card) {
	rank := func(r string) int {
		if v, ok := rarityOrder[r]; ok {
			return v
		}
		return 50
	}
	sort.SliceStable(cards, func(i, j int) bool {
		a, aErr := strconv.Atoi(cards[i].Number)
		b, bErr := strconv.Atoi(cards[j].Number)
		switch {
		case aErr == nil && bErr == nil:
			if a != b {
				return a < b
			}
			return rank(cards[i].Rarity) < rank(cards[j].Rarity)
		case aErr != nil && bErr != nil:
			return cards[i].Number < cards[j].Number
		default:
			return aErr == nil
		}
	})
}

var (
	spCodeRe     = regexp.MustCompile(`(?i)-(SP\d+)/`)
	suffixCodeRe = regexp.MustCompile(`-(\d+)([a-zA-Z]?)\*?/`)
)

// displayNumber is a port of TCG Haven's riftboundDisplayNumber: Riftbound
// keeps the alt-art letter ("92a") and "SP" subset codes only in
// publicCode, so recover them from there. A no-op for cards without one.
func displayNumber(number, publicCode string) string {
	if m := spCodeRe.FindStringSubmatch(publicCode); m != nil {
		return strings.ToUpper(m[1])
	}
	m := suffixCodeRe.FindStringSubmatch(publicCode)
	if m == nil {
		return number
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		return number
	}
	return strconv.Itoa(n) + m[2]
}

// SinglesRarities are the only rarities a Singles Shop can stock — an
// explicit product decision: the Singles Shop is for cheap singles a buyer
// tops an order up with. Epics, Alt Arts, Overnumbered, Signature/Star,
// Showcase, Promo, Metal, etc. are chase cards sold as regular photo
// listings instead.
var SinglesRarities = []string{"Common", "Uncommon", "Rare"}

var (
	altArtCodeRe    = regexp.MustCompile(`\d+[a-zA-Z]/`)
	collectorCodeRe = regexp.MustCompile(`-(\d+)[a-zA-Z]?\*?/(\d+)`)
)

// foilOnly reports whether a card is only printed as a foil. In Riftbound,
// Commons and Uncommons come in both Non-foil and Foil (with different
// market prices); every Rare and up is always foil (explicit product
// rule, and TCG Haven's two prices for those are identical). Other games
// aren't classified yet, so they keep both finishes.
func foilOnly(gameSlug, rarity string) bool {
	if gameSlug != "riftbound" {
		return false
	}
	return rarity != "Common" && rarity != "Uncommon"
}

// singlesEligible applies SinglesRarities, plus the print checks from TCG
// Haven's riftboundVariantFlags: some sets (Unleashed, Vendetta) keep the
// base card's rarity ("Rare") on their alt-art, overnumbered, and
// signature prints, so the rarity string alone would let those through.
// The printed code is what gives them away — an "a"-suffixed number
// (alt art), a "*" (signature), or a number above the set's total
// (overnumbered).
func singlesEligible(rarity, publicCode string) bool {
	allowed := false
	for _, r := range SinglesRarities {
		if r == rarity {
			allowed = true
			break
		}
	}
	if !allowed {
		return false
	}
	if strings.Contains(publicCode, "*") || altArtCodeRe.MatchString(publicCode) {
		return false
	}
	if m := collectorCodeRe.FindStringSubmatch(publicCode); m != nil {
		n, _ := strconv.Atoi(m[1])
		total, _ := strconv.Atoi(m[2])
		if total > 0 && n > total {
			return false
		}
	}
	return true
}

func str(v any) string {
	s, _ := v.(string)
	return s
}
