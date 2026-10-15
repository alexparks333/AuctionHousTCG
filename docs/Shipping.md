# Shipping — current system reference

**Status: built and live.** This is the "what's actually true today" reference for
shipping: presets, value thresholds, real-carrier rate quoting, and the frontend's
live-upgrade display. `docs/Shipping_Research.md` is the pre-implementation research
this was originally built from (vendor selection, packaging research) — keep reading
that one for *why* Shippo/Pitney Bowes were picked and how the two-vendor dispatch
works; CLAUDE.md §6.18/§6.19 covers that same vendor-integration history. This doc is
the up-to-date picture of the preset/threshold/signature/live-quote system layered on
top of it, most of which landed after §6.18/§6.19 were written.

---

## 1. The five presets

| Preset | Mechanism | Buyer cost | Vendor |
|---|---|---|---|
| `free_envelope` | Letter | Free (seller absorbs) | Pitney Bowes |
| `tracked_envelope` | Letter | Flat `TrackedEnvelopeCents` = $1.56 | Pitney Bowes |
| `free_bubble_mailer` | Package | Free (seller absorbs) | Shippo |
| `free_box` | Package | Free (seller absorbs) | Shippo |
| `shippo_ground_advantage` | Package | Real rate-shopped quote | Shippo |

All five live in `apps/api/internal/shipping/preset.go` (`Preset` type). Pitney Bowes'
envelope labels (IMb, First-Class) can never carry signature confirmation or a
meaningfully-tracked delivery guarantee — that's the whole reason the value thresholds
below exist.

**Buyer-facing naming (`apps/web/lib/types.ts`)**: `free_bubble_mailer` and `free_box`
both display as **"Tracked Package"** — a buyer never needs to tell them apart, even
though they're two distinct real packaging choices in the Sell wizard (different
`approxCents`, different physical container). This matters most for the
`free_envelope -> free_bubble_mailer` upgrade path below: without the merge, an
upgraded envelope listing read as "Tracked Bubble Mailer," a needlessly different-
sounding word for the same thing "Tracked Package" already says everywhere else.

---

## 2. The two value thresholds — now unified to one number

```go
// apps/api/internal/shipping/preset.go
const (
    PackageRequiredCents   = 10000  // $100
    SignatureRequiredCents = 25000  // $250
)
```

- **$100 (`PackageRequiredCents`)** — envelope (either flavor) stops being valid.
  `RequiredMechanism(amountCents)` returns `MechanismPackage` at or above this.
- **$250 (`SignatureRequiredCents`)** — signature confirmation becomes mandatory.

**These used to be two separate constants** ($250 for a listing-time heuristic, $500
for the final-sale-price rule) until a real gap surfaced: a $0.99-starting auction that
climbed to $270 required a tracked package (crossed $100) but **no signature**, since
$270 was under the old $500 bar. `SignatureRequiredCents` is now the single number both
of the following check:

```go
// Listing-time (internal/listing.Create/Update) — checked against whichever of the
// listing's own prices is highest and already known: starting bid, Buy It Now price,
// or a fixed listing's own price.
func RequestSignatureFromPrice(referencePriceCents int64) bool {
    return referencePriceCents >= SignatureRequiredCents
}

// Final-sale-price (checkout/close time) — UpgradePreset checks the same threshold
// again, directly against the real final amount.
func UpgradePreset(chosen Preset, finalAmountCents int64, sellerRequestedSignature bool) (resolved Preset, signatureRequired bool) {
    resolved = chosen
    if RequiredMechanism(finalAmountCents) == MechanismPackage && chosen.Mechanism() == MechanismLetter {
        if chosen.IsFree() {
            resolved = PresetFreeBubbleMailer
        } else {
            resolved = PresetShippoGroundAdvantage
        }
    }
    signatureRequired = sellerRequestedSignature || finalAmountCents >= SignatureRequiredCents
    return resolved, signatureRequired
}
```

`UpgradePreset` is called fresh, every time, at every point money actually moves:
`checkout.go` (authorization), `buynow.go` (capture), `close.go` (auction-close pending
order), `offer.go` (accepted-offer pending order). Nothing about the resolved mechanism
or signature requirement is ever trusted from an earlier computation — see CLAUDE.md
§5.3's race-safety principle, applied here to money-adjacent shipping decisions instead
of bid placement.

---

## 3. Signature: locked-in vs. voluntary

A listing's `request_signature` column (migration `0057_listing_request_signature`,
`internal/listing.Listing.RequestSignature`) is **server-derived, never client-trusted
outright**:

```go
requestSignature := (in.RequestSignature && preset.Mechanism() == shipping.MechanismPackage) ||
    shipping.RequestSignatureFromPrice(referencePriceCents)
```

- **Locked on, no opt-out**: once the listing's own starting bid/Buy It Now/fixed price
  crosses $250, this is `true` regardless of what the seller sends — a seller listing
  something this valuable doesn't get a choice, same as the final-price rule isn't a
  choice either.
- **Voluntary opt-in below $250**: a seller can check "Signature Required" on any
  package-mechanism preset (Ground Advantage, or Free Shipping's Tracked Bubble
  Mailer/Tracked Package) even on a cheap item, for their own peace of mind. Silently
  dropped if requested against an envelope preset — Pitney Bowes can't carry it at all,
  and the frontend never shows the checkbox for envelope options in the first place.

**Frontend (`ShippingPresetPicker.tsx`)**:
- Free Shipping is **never fully disabled** at $100+ or $250+ — a seller can always
  still pay for shipping themselves, they just have to do it with a real tracked
  package. Only the **envelope option specifically** (free or paid) gets disabled at
  either bar.
- At $250+, if envelope was selected, it auto-corrects to whichever preset the backend
  itself would upgrade to (`free_envelope -> free_bubble_mailer`,
  `tracked_envelope -> shippo_ground_advantage`) — same mapping as `UpgradePreset`, so
  the UI never shows a disabled-but-still-"selected" envelope radio.
- The "Signature Required" checkbox renders directly under whichever package-mechanism
  option is currently selected (in the Free Shipping sub-list, or under Ground
  Advantage) — checked-and-disabled once `referencePriceCents >= SIGNATURE_REQUIRED_CENTS`,
  otherwise a real, independently-toggleable choice.
- Approximate surcharge shown next to the checkbox: `SIGNATURE_SURCHARGE_APPROX_CENTS`
  = 415 ($4.15 — the current USPS Signature Confirmation rate through Shippo). Same
  "representative figure, not a live quote" shape as every other `approxCents` value in
  that component.

**Submit-time validation** (`SellWizard.tsx`, `EditListingForm.tsx`): if Tracked
Envelope is still selected while the reference price is $100+ (can happen if the price
was raised after picking envelope, since only the $250 bar auto-corrects), submission
is blocked with **"Anything above $100 can't use Tracked Envelope."** — mirrors the
picker's own disabled state with a specific, actionable message instead of a generic
server rejection.

---

## 4. Checkout-time live rate quoting

The historical gap: a buyer was charged whatever estimate was quoted at **listing
creation time** (against a placeholder reference address, since the real buyer wasn't
known yet), while the seller's actual label — bought later, against the real buyer
address — could cost more or less. Same problem eBay's own "calculated shipping"
solves by quoting at the moment of purchase, not at listing time.

**`shipping.ChargedCentsLive`** (`shippo.go`) is the fix:

```go
func ChargedCentsLive(ctx context.Context, shippoClient *Client, preset Preset, from, to *address.Address,
    fromEmail, toEmail string, signatureRequired bool, estimatedShippingCents *int64) int64
```

Called from `checkout.go`'s `HandleCreateCheckoutIntent` with the seller's and buyer's
**real** saved addresses — a genuine Shippo rate-shop, not an estimate — falling back to
the old estimate-based `ChargedCents` only when Shippo isn't configured, an address is
missing, or the live call itself fails. Only ever attempted for
`shippo_ground_advantage` (free/flat presets don't need it).

**Correctness across the authorize -> capture gap**: the live-quoted number is stamped
onto the Stripe PaymentIntent's own metadata at creation time
(`payment.shippingMetadata`: `shipping_cents`, `signature_required`), and
`buynow.go`'s `createOrderRecord` reads it back from there
(`shippingFromMetadata`) instead of recomputing — guaranteeing the order's recorded
shipping cost always matches what Stripe actually captured, even if carrier rates
shifted in the seconds between authorization and capture. Falls back to the old
estimate-based computation only for a PaymentIntent that predates this metadata.

**Ambiguous "Shipping cost at checkout" fix**: when a listing's effective preset (see
§5) resolves to `shippo_ground_advantage` but was never quoted for it (upgraded from an
envelope preset that never had an estimate), the display falls back to
`DEFAULT_PACKAGE_ESTIMATE_CENTS` = 600 ($6.00) — the exact same fallback
`shipping.ChargedCents` itself uses server-side for an upgraded order with no real
estimate, so the number a buyer sees is never a fabricated one, just a shared,
consistent fallback.

---

## 5. Live "effective shipping" on the frontend

**`effectiveShipping(preset, priceCents, requestSignature)`** (`lib/types.ts`) mirrors
`UpgradePreset` exactly, purely for display — the backend always recomputes the real
thing fresh at checkout/close time regardless of what this shows:

```ts
export function effectiveShipping(
  preset: ShippingPreset,
  priceCents: number,
  requestSignature: boolean,
): { preset: ShippingPreset; signatureRequired: boolean; upgraded: boolean }
```

Used on both the listing detail page (`AuctionPriceBox.tsx`) and homepage/grid cards
(`ListingCard.tsx`), fed by each component's own live price poll (2s interval,
`getListing`, same shape as the existing bid/price polling — cards poll too now,
gated to `format === "auction" && !hasEnded` so a fixed-price or ended card never
polls anything).

**The "Upgraded" badge — a REAL bidding-driven upgrade, not just "differs from
stored"**: comparing the current effective preset/signature against what the listing
would already resolve to *at its own starting bid* is what tells apart two states that
otherwise look identical:

```ts
const original = effectiveShipping(listing.shippingPreset, listing.startingBidCents ?? 0, listing.requestSignature);
const isBidDrivenUpgrade = effective.preset !== original.preset || effective.signatureRequired !== original.signatureRequired;
```

- A $0.01-starting auction real bids pushed to $100+: `original` (evaluated at $0.01)
  still resolves to the seller's original envelope preset, `effective` (at the live
  price) doesn't — a genuine bidding-driven change, badge shows, however long ago it
  crossed the line or whether this exact page load just caught it live.
- A listing whose **starting bid was already** past the bar (a stale seller-chosen
  preset predating this feature, e.g. a $120 starting bid still set to Tracked
  Envelope): `original` already resolves the same way `effective` does — nothing about
  it moved because of bidding, so no badge, even though the stored preset is still
  technically "wrong" for the price. Was previously (incorrectly) gated on a
  session/mount-order ref that suppressed the badge for *any* listing already past the
  bar on page load, including real ones — fixed by comparing against the starting bid
  instead of "what did this page happen to observe first."

**Where each surface differs**:
- **Detail page (`AuctionPriceBox.tsx`)**: shows the full "Upgraded" pill (gold,
  animates in via `animate-pop-in`, keyed on `isBidDrivenUpgrade` so it only replays on
  an actual live flip) next to the shipping cost/method line, plus a
  "Signature required at delivery" line with a **Feather** (quill) icon when
  applicable.
- **Grid cards (`ListingCard.tsx`)**: no badge bubble at all — not enough room to
  explain it. Instead, just the same Feather/quill icon appears to the right of the
  shipping line whenever signature is required, with a native `title` tooltip reading
  "Signature Needed."

---

## 6. Real vendor integration (unchanged from CLAUDE.md §6.18/§6.19)

Shippo handles every package-mechanism preset; Pitney Bowes handles both envelope
presets. `HandleBuyLabel` (`label.go`) dispatches purely on the order's snapshotted
`shipping_preset`/mechanism — never on which vendor happens to be configured — so a
tracked_envelope order can only ever reach the Pitney Bowes branch, a
shippo_ground_advantage order only Shippo. Full research, packaging choices, and the
live-verified $1.56 Pitney Bowes rate breakdown are in `docs/Shipping_Research.md` and
CLAUDE.md §6.18/§6.19 — not repeated here.

**Signature confirmation on a real label**: `BuyLabel`'s `signatureRequired` param
(threaded from the order's own `SignatureRequired`, itself resolved by `UpgradePreset`)
sets Shippo's `extra.signature_confirmation: "STANDARD"` on the real shipment request
before rates are even fetched — so the quoted/purchased cost already includes the
~$4.15 USPS surcharge, never a separate line item the seller has to account for by hand.

---

## 7. Open / known gaps

- **Test/dev data predating these rules**: listings seeded before the $100/$250
  validation existed (or via `/dev/quick-list`, which doesn't enforce the same checks)
  can have a stored preset/price combo that was never valid through the real Create
  path. `effectiveShipping`'s starting-bid comparison (§5) correctly treats these as
  "always was this way," not a bidding-driven upgrade — but the underlying data is
  still stale and would be worth a one-time backfill/audit before this matters in
  production.
- **Envelope-mechanism validation for auctions**: the $100+ envelope rejection at
  Create/Update time is still fixed-price-only (`in.Format == FormatFixed` in
  `listing.go`) — an auction can still be *created* with envelope shipping and a
  starting bid or Buy It Now price already over $100 (the frontend's own $100/$250
  checks now correctly block/auto-correct this in the wizard using
  `referencePriceCents`, but the backend doesn't independently reject it the way it
  does for a fixed listing). Not currently a real bug (the frontend catches it, and
  `UpgradePreset` resolves correctly at sale time regardless), but worth closing the
  gap for defense-in-depth against a direct API call bypassing the wizard.
- **Pitney Bowes billing-layer question** (carried over from CLAUDE.md §6.18): whether
  Shipping 360 layers its own per-label fee on top of the $1.56 carrier postage in
  production is still unconfirmed — a sandbox response has no reason to reflect that.
