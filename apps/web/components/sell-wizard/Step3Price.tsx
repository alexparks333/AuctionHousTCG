"use client";

import type { FormEvent, ReactNode } from "react";
import { ArrowLeft, Check, Gavel, Loader2, Tag, Zap } from "lucide-react";
import StepHeader, { StepFooter, primaryButtonClass, secondaryButtonClass } from "./StepHeader";
import type { WizardData, UpdateField } from "../SellWizard";
import { formatPrice } from "@/lib/types";
import MoneyInput from "./MoneyInput";
import ShippingPresetPicker from "./ShippingPresetPicker";

export default function Step3Price({
  data,
  update,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  data: WizardData;
  update: UpdateField;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  const priceCents = data.format === "fixed" ? Math.round(Number.parseFloat(data.price || "0") * 100) : 0;
  const isFixed = data.format === "fixed";

  // Offers (CLAUDE.md's "allow offers, with a real minimum" ask) only ever
  // make sense against a real Buy It Now price — a fixed listing always
  // has one (its own price), an auction only once "Also offer a Buy It Now
  // price" is turned on above. offersEligible controls whether the section
  // renders at all (as soon as a BIN price *can* exist, even before a
  // number's typed in) — gating it on hasBinPrice instead would hide the
  // whole feature the moment the price field is empty, which reads as "it
  // doesn't exist" rather than "type a price first." hasBinPrice only
  // gates the parts that need a real number: the "below $X" copy and the
  // minimum-offer validation.
  const offersEligible = isFixed || data.buyItNowEnabled;
  const binPriceCents = isFixed
    ? priceCents
    : data.buyItNowEnabled
      ? Math.round(Number.parseFloat(data.buyItNowPrice || "0") * 100)
      : 0;
  const hasBinPrice = binPriceCents > 0;

  // The minimum-offer example tracks the Buy It Now price: about 15% under
  // it, rounded to the nearest dollar (and always strictly below it).
  const suggestedMinOffer = suggestMinOffer(binPriceCents);

  // Mirrors internal/listing.Create's own minOfferCents validation — a
  // minimum offer at or above the Buy It Now price makes no sense (the
  // buyer would just pay the BIN price instead), so this is caught live
  // as the seller types rather than only surfacing as a submit-time error
  // banner. Only evaluated once there's both a real BIN price and a
  // non-empty minOffer — an empty field isn't "invalid," it just means no
  // floor was set.
  const minOfferCents = Math.round(Number.parseFloat(data.minOffer || "0") * 100);
  const minOfferTooHigh = hasBinPrice && data.minOffer.trim() !== "" && minOfferCents >= binPriceCents;

  // The Signature Required lock's own reference price (ShippingPresetPicker)
  // — whichever of the auction's starting bid or Buy It Now price is
  // higher, or the fixed price. Always knowable at listing time, unlike
  // knownPriceCents below (which stays 0 for an auction on purpose).
  const startingBidCents =
    data.format === "auction" ? Math.round(Number.parseFloat(data.startingBid || "0") * 100) : 0;
  const referencePriceCents = Math.max(startingBidCents, binPriceCents);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <StepHeader icon={<Tag size={20} />} step={3} title="Set the price">
        Auction or fixed price, plus how it ships.
      </StepHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormatButton
          icon={<Gavel size={18} />}
          label="Auction"
          description="Buyers bid — highest bid when time runs out wins."
          selected={data.format === "auction"}
          onClick={() => update("format", "auction")}
        />
        <FormatButton
          icon={<Zap size={18} />}
          label="Buy It Now"
          description="A fixed price — the first buyer gets it."
          selected={data.format === "fixed"}
          onClick={() => update("format", "fixed")}
        />
      </div>

      <FormSection title="Price">
        {data.format === "auction" ? (
          <div className="flex flex-wrap items-start gap-4">
            <MoneyInput
              label="Starting bid"
              required
              value={data.startingBid}
              onChange={(v) => update("startingBid", v)}
              placeholder="5.00"
            />

            <label className="flex w-48 flex-col gap-1.5 text-sm font-medium text-gray-700">
              Auction length
              <select
                value={data.durationMinutes}
                onChange={(e) => update("durationMinutes", Number(e.target.value))}
                className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3.5 text-base font-semibold text-gray-900 shadow-sm outline-none transition-colors focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.minutes} value={opt.minutes}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <MoneyInput
            label="Price"
            required
            value={data.price}
            onChange={(v) => update("price", v)}
            placeholder="24.99"
          />
        )}
      </FormSection>

      {data.format === "auction" && (
        <FormSection title="Buy It Now" optional>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={data.buyItNowEnabled}
              onChange={(e) => update("buyItNowEnabled", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
            />
            Allow Buy It Now Price
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Buyers can buy it instantly at a set price before the first bid.
          </p>

          {data.buyItNowEnabled && (
            <div className="mt-3">
              <MoneyInput
                label="Buy It Now price"
                required
                value={data.buyItNowPrice}
                onChange={(v) => update("buyItNowPrice", v)}
                placeholder="49.99"
              />
            </div>
          )}
        </FormSection>
      )}

      {offersEligible && (
        <FormSection title="Offers" optional>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={data.allowOffers}
              onChange={(e) => update("allowOffers", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
            />
            Allow offers{hasBinPrice ? ` below ${formatPrice(binPriceCents)}` : ""}
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Buyers can send a lower offer instead of paying{" "}
            {hasBinPrice ? formatPrice(binPriceCents) : "your Buy It Now price"} outright.
          </p>

          {data.allowOffers && (
            <div className="mt-3">
              <MoneyInput
                label="Minimum offer (optional)"
                value={data.minOffer}
                onChange={(v) => update("minOffer", v)}
                placeholder={suggestedMinOffer ? `e.g. ${suggestedMinOffer}` : "e.g. 20.00"}
                error={
                  minOfferTooHigh
                    ? `Must be less than ${formatPrice(binPriceCents)} — that's your Buy It Now price.`
                    : undefined
                }
              />
              {!minOfferTooHigh && (
                <p className="mt-1 text-xs text-gray-500">
                  {hasBinPrice ? (
                    <>
                      Offers below this amount can&apos;t be sent at all. Leave blank to consider
                      any offer under {formatPrice(binPriceCents)}.
                    </>
                  ) : (
                    "Offers below this amount can't be sent at all. Leave blank to consider any offer under your Buy It Now price — set that above first."
                  )}
                </p>
              )}
            </div>
          )}
        </FormSection>
      )}

      <FormSection title="Shipping">
        <ShippingPresetPicker
          value={data.shippingPreset}
          onChange={(v) => update("shippingPreset", v)}
          referencePriceCents={referencePriceCents}
          requestSignature={data.requestSignature}
          onRequestSignatureChange={(v) => update("requestSignature", v)}
        />
      </FormSection>

      {error && (
        <p className="rounded-xl border border-brand-urgent/30 bg-brand-urgent/5 px-4 py-3 text-sm font-medium text-brand-urgent">
          {error}
        </p>
      )}

      <StepFooter>
        <button type="button" onClick={onBack} className={secondaryButtonClass}>
          <ArrowLeft size={16} /> Back
        </button>
        <button
          type="submit"
          disabled={submitting || minOfferTooHigh}
          title={minOfferTooHigh ? "Fix the minimum offer above before listing" : undefined}
          className={primaryButtonClass}
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Listing...
            </>
          ) : (
            <>
              <Check size={16} strokeWidth={2.5} /> List it
            </>
          )}
        </button>
      </StepFooter>
    </form>
  );
}

// ~15% below the Buy It Now price, rounded to the nearest dollar, as a
// dollars string ("23.00"). Rounding can land on the price itself for
// cheap cards (e.g. $3 -> $2.55 -> $3), so it's pulled down a dollar then;
// under $2 it falls back to the exact 15%-off amount in cents.
function suggestMinOffer(binCents: number): string | null {
  if (binCents <= 0) return null;
  let dollars = Math.round((binCents * 0.85) / 100);
  if (dollars * 100 >= binCents) dollars -= 1;
  if (dollars >= 1) return `${dollars}.00`;
  const cents = Math.max(1, Math.floor(binCents * 0.85));
  return cents < binCents ? (cents / 100).toFixed(2) : null;
}

// One visually consistent card per pricing concern (Price, Buy It Now,
// Offers, Shipping) — each optional/conditional section used to be its own
// ad hoc box (some bordered, some not) stacked directly on top of the
// next with no shared rhythm, which read as a long flat pile of unrelated
// fields rather than a few grouped decisions. `optional` just tags the
// header for sections that aren't part of every listing (Buy It Now,
// Offers) so a seller skimming the page can tell at a glance which
// sections apply only if they opt in.
function FormSection({
  title,
  optional,
  children,
}: {
  title: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-gray-50/40 p-5">
      <h3 className="text-sm font-bold text-gray-900">
        {title}
        {optional && <span className="ml-1.5 text-xs font-medium text-gray-400">Optional</span>}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// Replaces the old cramped inline radio pair with two equal-width buttons
// — this is the single most important choice on the whole step (it
// determines which of the sections below even apply), so it gets more
// visual weight than a plain radio row would give it.
function FormatButton({
  icon,
  label,
  description,
  selected,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
        selected
          ? "border-brand-navy bg-brand-navy text-white shadow-lg shadow-brand-navy/20"
          : "border-gray-200 bg-white text-gray-700 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-sm"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          selected ? "bg-white/10 text-brand-gold-light" : "bg-gray-100 text-gray-500"
        }`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-bold">{label}</span>
        <span className={`mt-0.5 block text-xs ${selected ? "text-white/70" : "text-gray-500"}`}>{description}</span>
      </span>
    </button>
  );
}

// Real product decision (CLAUDE.md §6.1): auctions run 2 days, 3.5 days, or
// 7 days — nothing else. The 1/2/5-minute options only exist to dissect the
// bidding engine without waiting days per test auction, and are compiled out
// of production builds since Next.js sets NODE_ENV="production" for
// `next build`/`next start` automatically (same gating as DevQuickSwitch).
const DURATION_OPTIONS: { label: string; minutes: number }[] = [
  ...(process.env.NODE_ENV === "development"
    ? [
        { label: "1 minute (dev)", minutes: 1 },
        { label: "2 minutes (dev)", minutes: 2 },
        { label: "5 minutes (dev)", minutes: 5 },
      ]
    : []),
  { label: "2 days", minutes: 2 * 24 * 60 },
  { label: "3.5 days", minutes: 3.5 * 24 * 60 },
  { label: "7 days", minutes: 7 * 24 * 60 },
];
