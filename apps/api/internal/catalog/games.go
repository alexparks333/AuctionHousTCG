package catalog

// Game is one of the fixed set of trading card games the marketplace
// supports. Keep this in sync with the CHECK constraint on listings.game
// in apps/api/migrations/0003_listings.up.sql — there's no dynamic
// per-game schema yet (CLAUDE.md §6.2's full item-specifics-schema table
// is a v2 upgrade once there's a real need to add games without a deploy).
type Game string

const (
	GamePokemon   Game = "Pokémon"
	GameMTG       Game = "Magic: The Gathering"
	GameYuGiOh    Game = "Yu-Gi-Oh!"
	GameLorcana   Game = "Disney Lorcana"
	GameRiftbound Game = "Riftbound"
	GameSports    Game = "Sports Cards"
)

var AllGames = []Game{
	GamePokemon, GameMTG, GameYuGiOh, GameLorcana, GameRiftbound, GameSports,
}

func IsValidGame(g string) bool {
	for _, game := range AllGames {
		if string(game) == g {
			return true
		}
	}
	return false
}

// EnabledGames is the subset of AllGames the marketplace is currently open
// for — Riftbound only for now, an explicit product decision to focus the
// launch (and the Singles Shop, internal/singles) on one game before
// widening back out. Other games' data is untouched: existing listings,
// orders, claims, seller profiles, and direct links all keep working; this
// only gates public browsing/search, category counts, card-catalog search,
// and creating new listings. Re-enabling a game is adding it back here
// (and to ENABLED_GAMES in apps/web/lib/types.ts), not a migration.
var EnabledGames = []Game{GameRiftbound}

func IsEnabledGame(g string) bool {
	for _, game := range EnabledGames {
		if string(game) == g {
			return true
		}
	}
	return false
}

// EnabledGameNames is EnabledGames as plain strings, for passing straight
// into a Postgres `= any($n)` parameter.
func EnabledGameNames() []string {
	names := make([]string, len(EnabledGames))
	for i, g := range EnabledGames {
		names[i] = string(g)
	}
	return names
}
