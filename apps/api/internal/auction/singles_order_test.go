package auction

import (
	"errors"
	"testing"

	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/shipping"
)

func singlesCart(qtyAndCents ...int64) []checkoutAddon {
	var out []checkoutAddon
	for i := 0; i+1 < len(qtyAndCents); i += 2 {
		out = append(out, checkoutAddon{Kind: addonKindSingle, Quantity: int(qtyAndCents[i]), UnitPriceCents: qtyAndCents[i+1]})
	}
	return out
}

func TestCheckSinglesCart(t *testing.T) {
	if err := checkSinglesCart(nil); !errors.Is(err, errSinglesOrderEmpty) {
		t.Errorf("empty cart: got %v, want errSinglesOrderEmpty", err)
	}

	// $2.40 — ten cents short.
	var below *singlesBelowMinimumError
	err := checkSinglesCart(singlesCart(4, 35, 1, 100))
	if !errors.As(err, &below) {
		t.Fatalf("$2.40 cart: got %v, want singlesBelowMinimumError", err)
	}
	if want := "Singles-only orders need at least $2.50 of singles — add $0.10 more."; err.Error() != want {
		t.Errorf("message = %q, want %q", err.Error(), want)
	}

	// Exactly the minimum passes.
	if err := checkSinglesCart(singlesCart(10, 25)); err != nil {
		t.Errorf("$2.50 cart: got %v, want nil", err)
	}

	withListing := append(singlesCart(10, 25), checkoutAddon{Kind: addonKindListing, Quantity: 1, UnitPriceCents: 3000})
	if err := checkSinglesCart(withListing); !errors.Is(err, errSinglesOrderOnly) {
		t.Errorf("cart with a listing: got %v, want errSinglesOrderOnly", err)
	}
}

func TestOrderCardCountAndShipping(t *testing.T) {
	container := &listing.Listing{SinglesOrder: true, ShippingPreset: string(shipping.PresetTrackedEnvelope)}
	card := &listing.Listing{ShippingPreset: string(shipping.PresetTrackedEnvelope)}

	twenty := singlesCart(20, 25)
	if got := orderCardCount(container, twenty); got != 20 {
		t.Errorf("container card count = %d, want 20 (no primary card)", got)
	}
	if got := orderCardCount(card, twenty); got != 21 {
		t.Errorf("card + add-ons count = %d, want 21", got)
	}

	// Singles-only: 20 cards is still an envelope, 21 is a package.
	if p, _ := resolveOrderShipping(container, 500, 20); p != shipping.PresetTrackedEnvelope {
		t.Errorf("20-card singles order ships %s, want tracked_envelope", p)
	}
	if p, _ := resolveOrderShipping(container, 525, 21); p != shipping.PresetShippoGroundAdvantage {
		t.Errorf("21-card singles order ships %s, want shippo_ground_advantage", p)
	}
	// The container's own preset is ignored even if it were free.
	freeContainer := &listing.Listing{SinglesOrder: true, ShippingPreset: string(shipping.PresetFreeEnvelope)}
	if p, _ := resolveOrderShipping(freeContainer, 300, 5); p != shipping.PresetTrackedEnvelope {
		t.Errorf("singles order with a free container preset ships %s, want tracked_envelope", p)
	}

	// A normal card checkout keeps the 10-card add-on rule.
	if p, _ := resolveOrderShipping(card, 500, shipping.EnvelopeMaxCards+1); p != shipping.PresetShippoGroundAdvantage {
		t.Errorf("11-card bundle ships %s, want shippo_ground_advantage", p)
	}
}
