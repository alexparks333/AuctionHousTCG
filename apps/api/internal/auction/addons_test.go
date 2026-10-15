package auction

import "testing"

func TestAddonsTotals(t *testing.T) {
	addons := []checkoutAddon{
		{Kind: addonKindSingle, Quantity: 3, UnitPriceCents: 25},
		{Kind: addonKindSingle, Quantity: 1, UnitPriceCents: 150},
		{Kind: addonKindListing, Quantity: 1, UnitPriceCents: 3500},
	}
	if got, want := addonsSubtotal(addons), int64(3*25+150+3500); got != want {
		t.Errorf("addonsSubtotal = %d, want %d", got, want)
	}
	if got, want := addonsCardCount(addons), 5; got != want {
		t.Errorf("addonsCardCount = %d, want %d", got, want)
	}
	if addonsSubtotal(nil) != 0 || addonsCardCount(nil) != 0 {
		t.Error("empty add-ons should total zero")
	}
}

func TestAddonUnavailableErrorListsEveryItem(t *testing.T) {
	err := &AddonUnavailableError{Items: []string{
		singleLabel("Rengar", "Near Mint", true, leftNote(0)),
		singleLabel("Against the Odds", "Lightly Played", false, leftNote(1)),
	}}
	want := "Sorry, someone bought these singles before you: Rengar (NM, Foil) — sold out, Against the Odds (LP, Non-foil) — only 1 left"
	if got := err.Error(); got != want {
		t.Errorf("Error() = %q\nwant      %q", got, want)
	}
	if got := (&AddonUnavailableError{}).Error(); got != "Sorry, someone bought these singles before you." {
		t.Errorf("empty Error() = %q", got)
	}
}
