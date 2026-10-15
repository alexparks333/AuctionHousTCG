"use client";

import { useEffect } from "react";
import type { ShippingPreset } from "@/lib/types";
import {
  TRACKED_ENVELOPE_CENTS,
  PACKAGE_REQUIRED_CENTS,
  SIGNATURE_REQUIRED_CENTS,
  SIGNATURE_SURCHARGE_APPROX_CENTS,
  formatPrice,
} from "@/lib/types";

const FREE_PRESETS: ShippingPreset[] = ["free_envelope", "free_bubble_mailer", "free_box"];

type PresetOption = {
  value: ShippingPreset;
  label: string;
  description: string;
  // A rough, non-binding approximation of what the seller will actually
  // pay for the real label — a live per-listing estimate only exists for
  // shippo_ground_advantage (listing.estimatedShippingCents, quoted at
  // create/edit time), so these are representative figures from real
  // observed rates for this weight class, not a live quote. Envelope
  // mirrors TRACKED_ENVELOPE_CENTS exactly (Pitney Bowes' flat rate
  // doesn't vary by destination); bubble mailer/box are real USPS Ground
  // Advantage quotes seen for these parcel sizes (docs/Shipping_Research.md).
  approxCents: number;
};

// Real quoted range from live USPS Ground Advantage rate-shops at this
// weight class (docs/Shipping_Research.md) — varies by zone/distance,
// which isn't knowable until a real buyer address exists, so a range is
// honestly what's available here rather than a single number.
const SHIPPO_GROUND_ADVANTAGE_APPROX_RANGE = `~${formatPrice(517)} – ${formatPrice(1000)}`;

const FREE_OPTIONS: PresetOption[] = [
  {
    value: "free_envelope",
    label: "Tracked Envelope",
    description: "You cover the cost of shipping a tracked envelope.",
    approxCents: TRACKED_ENVELOPE_CENTS,
  },
  {
    value: "free_bubble_mailer",
    label: "Tracked Bubble Mailer",
    description: "You cover the cost of shipping a tracked bubble mailer.",
    approxCents: 517,
  },
  {
    value: "free_box",
    label: "Tracked Package",
    description: "You cover the cost of shipping a tracked package.",
    approxCents: 600,
  },
];

// The Shipping picker body — shared by the Sell wizard's Step3Price and
// the Edit Listing form (EditListingForm), so a pricing-threshold change
// only ever needs to happen in one place. Pure UI: the caller owns
// `value`/`onChange` and passes in the seller's own listing-time price
// (referencePriceCents below) — the same figure drives both the $100 and
// $250 thresholds for every format, fixed or auction.
// Presets a signature can actually be attached to — Pitney Bowes' envelope
// labels (free_envelope/tracked_envelope) don't support it at all (see
// apps/api/internal/shipping/pitneybowes.go's BuyLabel doc comment), so
// this list is exactly PresetOption's package-mechanism trio.
const SIGNATURE_CAPABLE_PRESETS: ShippingPreset[] = ["shippo_ground_advantage", "free_bubble_mailer", "free_box"];

export default function ShippingPresetPicker({
  value,
  onChange,
  referencePriceCents,
  requestSignature,
  onRequestSignatureChange,
}: {
  value: ShippingPreset;
  onChange: (preset: ShippingPreset) => void;
  // Whatever price IS known at listing time — an auction's starting bid
  // and/or Buy It Now price, or a fixed listing's own price, whichever is
  // highest. Drives both the $100 envelope-unavailable rule and the $250
  // signature-request lock below (mirrors apps/api/internal/shipping.
  // RequestSignatureFromPrice) — checked against the seller's own
  // listing-time price, same for every format, since a starting bid this
  // high guarantees the final sale price will be too (an auction's price
  // only ever goes up from there).
  referencePriceCents: number;
  // The seller's own voluntary "add signature confirmation" choice —
  // meaningful (and shown) only while a signature-capable preset is
  // selected; ORed server-side with the $250 price-driven rule
  // (apps/api/internal/listing.Create/Update), so checking this below $250
  // has the same real effect as crossing the price bar.
  requestSignature: boolean;
  onRequestSignatureChange: (v: boolean) => void;
}) {
  const overPackageThreshold = referencePriceCents >= PACKAGE_REQUIRED_CENTS;
  const overSignatureThreshold = referencePriceCents >= SIGNATURE_REQUIRED_CENTS;
  // Envelope (paid or free) stops being an option at $100+, and stays off
  // the table at $250+ too — but Free Shipping itself never gets disabled
  // at either bar: a seller can always still pay for shipping themselves,
  // they just have to do it with a real tracked package (bubble mailer or
  // box), same restriction shippo_ground_advantage/paid shipping is under.
  const envelopeDisabled = overPackageThreshold || overSignatureThreshold;
  const isFreeSelected = FREE_PRESETS.includes(value);
  const signatureCapable = SIGNATURE_CAPABLE_PRESETS.includes(value);

  // Once the seller's price crosses $250, envelope (either flavor) is no
  // longer valid — auto-correct away from it to whichever package-mechanism
  // preset the backend itself would upgrade to (shipping.UpgradePreset:
  // free_envelope -> free_bubble_mailer, tracked_envelope ->
  // shippo_ground_advantage), same mapping, so the UI never shows a
  // disabled-but-still-"selected" envelope radio. Bubble mailer/box/Ground
  // Advantage are all still perfectly valid at $250+ (just with signature
  // now locked on below), so nothing forces a switch away from those. Only
  // runs when overSignatureThreshold actually flips, not on every
  // keystroke/re-render.
  useEffect(() => {
    if (!overSignatureThreshold) return;
    if (value === "free_envelope") {
      onChange("free_bubble_mailer");
    } else if (value === "tracked_envelope") {
      onChange("shippo_ground_advantage");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overSignatureThreshold]);

  // Switching to an envelope preset makes a standing voluntary request
  // meaningless (the backend would silently drop it anyway, see Create's
  // own doc comment) — clear it here too so the checkbox never looks
  // checked again if the seller switches back before submitting.
  useEffect(() => {
    if (!signatureCapable && requestSignature) {
      onRequestSignatureChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureCapable]);

  return (
    <div className="flex flex-col gap-2">
      <PresetRadio
        label="Free Shipping"
        description="You pay for shipping — the buyer sees $0."
        checked={isFreeSelected}
        disabled={false}
        onSelect={() => onChange("free_bubble_mailer")}
      />

      {isFreeSelected && (
        <div className="ml-4 flex flex-col gap-2 border-l-2 border-gray-200 py-1 pl-4">
          {FREE_OPTIONS.map((opt) => {
            const disabled = opt.value === "free_envelope" && envelopeDisabled;
            const selected = value === opt.value;
            return (
              <div key={opt.value}>
                <PresetRadio
                  label={opt.label}
                  description={opt.description}
                  approxCost={`~${formatPrice(opt.approxCents)}`}
                  checked={selected}
                  disabled={disabled}
                  onSelect={() => onChange(opt.value)}
                />
                {selected && SIGNATURE_CAPABLE_PRESETS.includes(opt.value) && (
                  <SignatureCheckboxRow
                    overSignatureThreshold={overSignatureThreshold}
                    requestSignature={requestSignature}
                    onRequestSignatureChange={onRequestSignatureChange}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <PresetRadio
        label="Tracked Envelope"
        description="Pitney Bowes tracked envelope — the buyer pays this flat rate."
        approxCost={`~${formatPrice(TRACKED_ENVELOPE_CENTS)}`}
        checked={value === "tracked_envelope"}
        disabled={envelopeDisabled}
        onSelect={() => onChange("tracked_envelope")}
      />
      <PresetRadio
        label="Tracked Package - Ground Advantage"
        description="Bubble mailer, full tracking. Buyer pays the real rate — shown on your listing once it's live."
        approxCost={SHIPPO_GROUND_ADVANTAGE_APPROX_RANGE}
        checked={value === "shippo_ground_advantage"}
        disabled={false}
        onSelect={() => onChange("shippo_ground_advantage")}
      />
      {value === "shippo_ground_advantage" && (
        <SignatureCheckboxRow
          overSignatureThreshold={overSignatureThreshold}
          requestSignature={requestSignature}
          onRequestSignatureChange={onRequestSignatureChange}
        />
      )}

      <p className="mt-1 text-xs text-gray-400">
        {overSignatureThreshold
          ? "This price requires a tracked bubble mailer or package (free or paid) with signature confirmation — envelope isn't available at $250+."
          : overPackageThreshold
            ? "This price requires a tracked bubble mailer or package (free or paid) — envelope isn't available above $100."
            : "Sales of $100+ require tracked shipping. Sales of $250+ require a signature."}
      </p>
    </div>
  );
}

// The voluntary "add signature confirmation" toggle — rendered right under
// whichever package-mechanism option is currently selected (Ground
// Advantage, or Free Shipping's Tracked Bubble Mailer/Tracked Package),
// never under an envelope option (Pitney Bowes can't carry a signature at
// all, see SIGNATURE_CAPABLE_PRESETS). Locked checked once
// overSignatureThreshold is true; otherwise a real, independent choice the
// seller can make regardless of price.
function SignatureCheckboxRow({
  overSignatureThreshold,
  requestSignature,
  onRequestSignatureChange,
}: {
  overSignatureThreshold: boolean;
  requestSignature: boolean;
  onRequestSignatureChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`ml-4 mt-1.5 flex items-start gap-2 rounded-lg border p-2.5 ${
        overSignatureThreshold
          ? "cursor-not-allowed border-brand-gold/30 bg-brand-gold/5 opacity-80"
          : "cursor-pointer border-gray-200 hover:bg-brand-surface"
      }`}
    >
      <input
        type="checkbox"
        checked={overSignatureThreshold || requestSignature}
        disabled={overSignatureThreshold}
        onChange={(e) => onRequestSignatureChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-brand-gold"
      />
      <span className="flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900">Signature Required</span>
          <span className="text-xs font-medium text-gray-500">
            +~{formatPrice(SIGNATURE_SURCHARGE_APPROX_CENTS)}
          </span>
        </span>
        <span className="block text-xs text-gray-500">
          {overSignatureThreshold
            ? "Required at $250+ — locked on for items this valuable."
            : "Optional — require a signature at delivery."}
        </span>
      </span>
    </label>
  );
}

function PresetRadio({
  label,
  description,
  approxCost,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  description: string;
  // Shown to the right of the label — a rough "here's what this will
  // probably cost you" figure, not the buyer-facing price (these are all
  // free-shipping sub-choices; the buyer always sees $0 regardless).
  approxCost?: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
        disabled
          ? "cursor-not-allowed border-gray-100 opacity-50"
          : checked
            ? "cursor-pointer border-brand-navy bg-brand-navy/5"
            : "cursor-pointer border-gray-200 hover:bg-brand-surface"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 accent-brand-navy"
      />
      <span className="flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900">{label}</span>
          {approxCost && <span className="text-xs font-medium text-gray-500">{approxCost}</span>}
        </span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );
}
