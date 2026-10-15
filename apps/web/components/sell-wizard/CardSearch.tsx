"use client";

import { Check, ChevronDown, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CatalogCard } from "@/lib/types";
import type { UpdateField } from "../SellWizard";
import { ENABLED_GAMES } from "@/lib/types";
import { searchCatalogCards, searchCatalogCardsAllGames } from "@/lib/api";

// Only games TCG Haven's catalog actually covers
// (apps/api/internal/cardcatalog/games.go) AND the marketplace currently
// has enabled (ENABLED_GAMES) — the only options worth offering in the
// game filter below, since every other game always resolves to zero
// results.
const CATALOG_SUPPORTED_GAMES = ["Pokémon", "Disney Lorcana", "Riftbound"].filter((g) =>
  (ENABLED_GAMES as string[]).includes(g),
);

// Sits above the Sell wizard's step box (not inside Step1Details' form) so
// it reads as "find your card first," separate from the hand-fillable
// fields below. Closing on outside-click (not onBlur) is deliberate — an
// onBlur-based close fights with clicking a result (blur fires before the
// click registers) and was the cause of "can't search again" after a
// selection: the dropdown could end up stuck closed with no clean way to
// reopen it. Click-outside avoids that whole race.
//
// Searches across every catalog-backed game at once by default
// (searchCatalogCardsAllGames, same endpoint the old Favorite Card widget
// picker uses) rather than being scoped to whatever the Game dropdown
// below currently says — the wizard used to default that dropdown to "Pokémon",
// so a per-game-scoped search silently only ever matched Pokémon cards
// unless a seller happened to change the dropdown first. `gameFilter`
// below is a separate, opt-in narrowing a seller can apply to this search
// box specifically, not tied to the wizard's own Game field. Picking a
// result always sets the wizard's Game field from the result itself
// (card.game, stamped by the API per-result), regardless of which filter
// was used to find it.
export default function CardSearch({ update }: { update: UpdateField }) {
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState("");
  const [results, setResults] = useState<CatalogCard[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CatalogCard | null>(null);
  const requestId = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shouldSearch = query.trim().length >= 2;
    const id = ++requestId.current;
    if (!shouldSearch) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears results when the query gets too short to search
      setLoading(false);
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const search = gameFilter
        ? searchCatalogCards(gameFilter, query)
        : searchCatalogCardsAllGames(query);
      search
        .then((cards) => {
          if (id === requestId.current) {
            setResults(cards);
            setOpen(true);
            setLoading(false);
          }
        })
        .catch(() => {
          if (id === requestId.current) {
            setResults([]);
            setLoading(false);
          }
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, gameFilter]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectCard(card: CatalogCard) {
    update("title", card.name);
    update("game", card.game);
    update("setName", card.setName);
    update("cardNumber", card.number);
    update("rarity", card.rarity);
    setSelectedCard(card);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function clearSelection() {
    setSelectedCard(null);
  }

  return (
    <div
      ref={wrapperRef}
      className="relative rounded-3xl border border-brand-gold/30 bg-gradient-to-br from-amber-50/80 via-white to-white p-5 shadow-xl shadow-brand-navy/5 sm:p-6"
    >
      {selectedCard ? (
        <div className="flex items-center gap-5">
          {selectedCard.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedCard.imageUrl}
              alt={selectedCard.name}
              className="h-32 w-auto rotate-[-2deg] rounded-lg shadow-lg ring-1 ring-black/5"
            />
          )}
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand-success">
              <Check size={12} strokeWidth={3} /> Details filled in
            </span>
            <p className="mt-1.5 truncate text-lg font-bold text-gray-900">{selectedCard.name}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
              {[selectedCard.game, selectedCard.setName, `#${selectedCard.number}`, selectedCard.rarity]
                .filter(Boolean)
                .map((t) => (
                  <span key={t} className="rounded-full bg-white px-2.5 py-1 font-medium text-gray-600 ring-1 ring-gray-200">
                    {t}
                  </span>
                ))}
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-navy hover:underline"
            >
              <RefreshCw size={12} /> Choose a different card
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="font-bold text-gray-900">Find your card</p>
                <p className="text-sm text-gray-500">Search the catalog and we&apos;ll fill in the details for you.</p>
              </div>
            </div>
            <span className="relative">
              <select
                value={gameFilter}
                onChange={(e) => setGameFilter(e.target.value)}
                aria-label="Game"
                className="appearance-none rounded-full border border-gray-200 bg-white py-1.5 pl-3.5 pr-8 text-xs font-semibold text-gray-700 shadow-sm outline-none transition-colors hover:border-gray-300 focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/15"
              >
                <option value="">All games</option>
                {CATALOG_SUPPORTED_GAMES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
            </span>
          </div>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (results.length > 0) setOpen(true);
              }}
              className="w-full rounded-2xl border border-gray-200 bg-white py-3.5 pl-11 pr-11 text-base text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-navy focus:ring-4 focus:ring-brand-navy/10"
              placeholder='Type a card name, e.g. "Rengar"'
            />
            {loading && (
              <Loader2
                size={17}
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-gray-400"
              />
            )}
          </div>
        </div>
      )}
      {open && (loading || results.length > 0) && (
        <div className="absolute inset-x-5 z-20 mt-2 max-h-[28rem] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl sm:inset-x-6">
          {loading && results.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" />
              Loading cards...
            </div>
          )}
          {results.length > 0 && (
            <ul>
              {results.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    onClick={() => selectCard(card)}
                    className="group flex w-full items-center gap-4 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-amber-50/60"
                  >
                    {card.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.imageUrl} alt="" className="h-20 w-auto rounded-md shadow-sm ring-1 ring-black/5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-gray-900">{card.name}</span>
                      <span className="block text-xs text-gray-500">
                        {card.game} · {card.setName} · #{card.number}
                        {card.rarity ? ` · ${card.rarity}` : ""}
                      </span>
                    </span>
                    <span className="hidden rounded-full bg-brand-navy px-3 py-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 sm:block">
                      Use this card
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
