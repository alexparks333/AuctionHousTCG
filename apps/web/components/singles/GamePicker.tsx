"use client";

import { ChevronDown } from "lucide-react";

// The game dropdown at the top of the sidebar — a <select>, not a list of
// buttons, because the Singles Shop will cover many games.
export default function GamePicker({
  games,
  value,
  onChange,
  countFor,
}: {
  games: readonly string[];
  value: string;
  onChange: (game: string) => void;
  // Shown after each game's name, e.g. how many cards are stocked.
  countFor?: (game: string) => number;
}) {
  return (
    <label className="mb-3 block border-b border-brand-border pb-3">
      <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Game</span>
      <span className="relative mt-1.5 block">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm font-semibold text-brand-navy shadow-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
        >
          {games.map((g) => (
            <option key={g} value={g}>
              {countFor ? `${g} (${countFor(g)})` : g}
            </option>
          ))}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
      </span>
    </label>
  );
}
