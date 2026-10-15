"use client";

import { useState } from "react";
import type { SellerTier } from "@/lib/api";

export type TierOption = {
  name: string;
  tier: SellerTier;
  rate: string; // e.g. "6.00%" — parsed for the math below, still shown verbatim
  accent: string;
};

const EXAMPLE_PRICES = [500, 1000, 5000, 10000, 25000];

// eBay's standard final value fee (CLAUDE.md's "~13.25%" is the rounder
// marketing figure this repo quotes elsewhere; 13.75% + $0.30 is the exact
// rate this comparison line uses) — a fixed reference point, not affected
// by which AuctionHous tier is selected above.
const EBAY_RATE_PCT = 13.75;
const EBAY_FLAT_CENTS = 0.3;

// Mirrors pkg/fees.ComputeQuote's flat-rate math exactly (percentage of
// price + a flat $0.30) — verified against the original hardcoded Gold
// numbers before this became interactive: $100 * 6% + $0.30 = $6.30 fee,
// $93.70 net.
function feeAndNet(priceDollars: number, ratePct: number) {
  const fee = priceDollars * (ratePct / 100) + 0.3;
  return { fee, net: priceDollars - fee };
}

function ebayFee(priceDollars: number) {
  return priceDollars * (EBAY_RATE_PCT / 100) + EBAY_FLAT_CENTS;
}

// Comma-formatted to 2 decimals — EXAMPLE_PRICES now runs up to $25,000
// (graded-slab/vintage territory), where a bare toFixed(2) reads as an
// illegible wall of digits ("23625.00" vs. "23,625.00").
function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The "What that looks like" section — starts on the viewer's own tier
// (initialTier, read server-side from their real users.tier so it's never
// a guess) and recomputes live when they click a different tier pill, so
// "what would Gold cost me" is answerable without doing the math by hand.
export default function TierFeeExplorer({
  tiers,
  initialTier,
}: {
  tiers: TierOption[];
  initialTier: SellerTier;
}) {
  const [selected, setSelected] = useState<SellerTier>(initialTier);
  const active = tiers.find((t) => t.tier === selected) ?? tiers[0];
  const ratePct = parseFloat(active.rate);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-full bg-brand-surface p-1 ring-1 ring-brand-border">
          {tiers.map((t) => (
            <button
              key={t.tier}
              type="button"
              onClick={() => setSelected(t.tier)}
              aria-pressed={selected === t.tier}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-all ${
                selected === t.tier
                  ? "bg-brand-navy text-white shadow-md shadow-brand-navy/20"
                  : "text-gray-600 hover:bg-white hover:text-brand-navy"
              }`}
            >
              {t.name}
              {t.tier === initialTier && (
                <span className={selected === t.tier ? "ml-1 text-brand-gold-light" : "ml-1 text-gray-400"}>
                  · you
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500">
          <span className={`font-bold ${active.accent}`}>{active.rate}</span> + $0.30 · no shipping, no tax
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {EXAMPLE_PRICES.map((price) => {
          const { fee, net } = feeAndNet(price, ratePct);
          const ebay = ebayFee(price);
          return (
            <div
              key={price}
              className="flex min-w-0 flex-col rounded-2xl bg-brand-surface/60 p-4 ring-1 ring-brand-border transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                ${price.toLocaleString("en-US")} sale
              </p>
              <p className="mt-3 text-[11px] text-gray-400">You keep</p>
              <p className="truncate text-xl font-extrabold tracking-tight text-gray-900 sm:text-2xl">${fmt(net)}</p>
              <dl className="mt-3 space-y-2 border-t border-brand-border/70 pt-3 text-xs">
                <div className="flex items-end justify-between gap-2">
                  <dt className="leading-tight text-gray-600">
                    Our fee
                    <span className="block text-[10px] text-gray-400">{active.rate}</span>
                  </dt>
                  <dd className="font-semibold text-gray-800">${fmt(fee)}</dd>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <dt className="leading-tight text-gray-500">
                    Other providers
                    <span className="block text-[10px] text-gray-400">{EBAY_RATE_PCT}%</span>
                  </dt>
                  <dd className="font-semibold text-brand-urgent line-through decoration-brand-urgent/40">
                    ${fmt(ebay)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 rounded-lg bg-emerald-50 px-2 py-1 text-center text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                +${fmt(ebay - fee)} more
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
