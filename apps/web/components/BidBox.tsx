"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { apiFetch, type BidResult } from "@/lib/api";
import type { Listing } from "@/lib/types";
import { shiftCentsInput } from "@/lib/format";

// No router.refresh() here anymore — that was a full Next.js server round
// trip (page re-fetch + re-render) just to show the price you already got
// back in the POST response. onBidPlaced hands that response straight to
// AuctionPriceBox, which updates the displayed price/leader instantly.
export default function BidBox({
  listing,
  onBidPlaced,
}: {
  listing: Listing;
  onBidPlaced: (result: BidResult, maxBidCents: number) => void;
}) {
  const [maxBid, setMaxBid] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  // Same cents-first shift-left typing as the Sell wizard's MoneyInput
  // (lib/format.shiftCentsInput) — type "1145" and it fills in 0.01, 0.11,
  // 1.14, 11.45 digit by digit, never a free-typed "1145" or "11.4.5".
  function handleMaxBidChange(e: ChangeEvent<HTMLInputElement>) {
    setMaxBid(shiftCentsInput(e.target.value));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const cents = Math.round(Number.parseFloat(maxBid) * 100);
    if (!cents || cents <= 0) {
      setError("Enter a valid bid amount.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    try {
      const result: BidResult = await apiFetch(`/listings/${listing.id}/bids`, {
        method: "POST",
        body: JSON.stringify({ maxBidCents: cents }),
      });
      onBidPlaced(result, cents);
      setMaxBid("");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place bid.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2">
      <div className="flex gap-2">
        <span className="relative w-full">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-gray-400">
            $
          </span>
          <input
            type="text"
            inputMode="decimal"
            required
            value={maxBid}
            onChange={handleMaxBidChange}
            placeholder="0.00"
            className="w-full rounded-xl border border-brand-border py-3 pl-8 pr-3 text-lg font-semibold text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-300 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
          />
        </span>
        <button
          type="submit"
          disabled={status === "loading"}
          className="shrink-0 rounded-xl bg-brand-navy px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-navy-light disabled:opacity-60"
        >
          {status === "loading" ? "Placing..." : "Place bid"}
        </button>
      </div>
      {error && <p className="text-sm text-brand-urgent">{error}</p>}
      <p className="text-xs text-gray-400">
        This is your private max — the price only rises as far as needed to beat the
        next-highest bidder.
      </p>
    </form>
  );
}
