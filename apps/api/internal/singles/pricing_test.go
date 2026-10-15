package singles

import "testing"

func TestLadderPriceCents(t *testing.T) {
	cases := []struct {
		market    int64
		condition string
		want      int64
	}{
		{1, "Near Mint", 10}, // below the floor is raised to it
		{7, "Near Mint", 10},
		{10, "Near Mint", 10},
		{24, "Near Mint", 10}, // rounds down, never up
		{31, "Lightly Played", 25},
		{88, "Near Mint", 75},
		{100, "Near Mint", 100},
		{260, "Near Mint", 250},
		{499, "Near Mint", 350},
		{700, "Near Mint", 500}, // capped
		{100000, "Near Mint", 500},
		{88, "Moderately Played", 50}, // one step down
		{700, "Moderately Played", 350},
		{12, "Moderately Played", 10}, // never below the floor
	}
	for _, c := range cases {
		if got := LadderPriceCents(c.market, c.condition); got != c.want {
			t.Errorf("LadderPriceCents(%d, %q) = %d, want %d", c.market, c.condition, got, c.want)
		}
	}
}

func TestConditionAllowed(t *testing.T) {
	for c, want := range map[string]bool{
		"Near Mint": true, "Lightly Played": true, "Moderately Played": true,
		"Heavily Played": false, "Damaged": false, "": false,
	} {
		if got := ConditionAllowed(c); got != want {
			t.Errorf("ConditionAllowed(%q) = %v, want %v", c, got, want)
		}
	}
}
