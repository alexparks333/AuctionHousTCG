package cardcatalog

import "testing"

func TestDisplayNumber(t *testing.T) {
	tests := []struct{ number, publicCode, want string }{
		{"92", "SFD-092a/221", "92a"},
		{"92", "SFD-092/221", "92"},
		{"6", "VEN-SP6/006", "SP6"},
		{"12", "OGN-012*/298", "12"},
		{"R01", "", "R01"},
		{"1/3", "", "1/3"},
	}
	for _, tt := range tests {
		if got := displayNumber(tt.number, tt.publicCode); got != tt.want {
			t.Errorf("displayNumber(%q, %q) = %q, want %q", tt.number, tt.publicCode, got, tt.want)
		}
	}
}

func TestSortCards(t *testing.T) {
	cards := []Card{
		{ID: "rune", Number: "R01"},
		{ID: "10", Number: "10", Rarity: "Common"},
		{ID: "2-alt", Number: "2", Rarity: "Alt Art"},
		{ID: "2", Number: "2", Rarity: "Rare"},
		{ID: "1", Number: "1", Rarity: "Epic"},
	}
	sortCards(cards)
	want := []string{"1", "2", "2-alt", "10", "rune"}
	for i, id := range want {
		if cards[i].ID != id {
			t.Fatalf("position %d = %s, want %s (got order %v)", i, cards[i].ID, id, cards)
		}
	}
}

func TestSinglesEligible(t *testing.T) {
	tests := []struct {
		rarity, publicCode string
		want               bool
	}{
		{"Common", "SFD-001/221", true},
		{"Uncommon", "SFD-040/221", true},
		{"Rare", "SFD-025/221", true},
		{"Rare", "UNL-183/219", true}, // high number, still within the set total
		{"Common", "UNL-R01", true},   // rune
		{"Common", "UNL-T01", true},   // token
		{"Epic", "UNL-120/219", false},
		{"Alt Art", "UNL-024a/219", false},
		{"Rare", "UNL-024a/219", false}, // alt art keeping the base rarity
		{"Rare", "VEN-179/166", false},  // overnumbered keeping the base rarity
		{"Overnumbered", "UNL-227/219", false},
		{"Star", "UNL-227*/219", false},
		{"Rare", "UNL-227*/219", false}, // signature keeping the base rarity
		{"Showcase", "SFD-R06a", false},
		{"Promo", "", false},
		{"Metal", "MTL-183/219", false},
	}
	for _, tt := range tests {
		if got := singlesEligible(tt.rarity, tt.publicCode); got != tt.want {
			t.Errorf("singlesEligible(%q, %q) = %v, want %v", tt.rarity, tt.publicCode, got, tt.want)
		}
	}
}

func TestFoilOnly(t *testing.T) {
	cases := []struct {
		game, rarity string
		want         bool
	}{
		{"riftbound", "Common", false},
		{"riftbound", "Uncommon", false},
		{"riftbound", "Rare", true},
		{"riftbound", "Epic", true},
		{"pokemon", "Rare", false},
	}
	for _, c := range cases {
		if got := foilOnly(c.game, c.rarity); got != c.want {
			t.Errorf("foilOnly(%q, %q) = %v, want %v", c.game, c.rarity, got, c.want)
		}
	}
}
