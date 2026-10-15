"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, ChevronDown, PackagePlus, Settings2, Store, X } from "lucide-react";
import SinglesBrowser from "@/components/checkout/SinglesBrowser";
import { CONDITION_SHORT, ENABLED_GAMES, formatPrice, type ShopSingle } from "@/lib/types";

// How many cards the profile previews before "Open Their Singles Shop".
const PREVIEW_COUNT = 5;

// A seller's Singles Shop on their public profile: a display case of their
// most expensive in-stock cards, plus a button that opens the whole shop in
// a dialog (SinglesBrowser, browse-only). Singles are never bought
// standalone — they're added to an order at checkout on top of a card
// bought or won from the same seller, which is what the copy here says.
export default function SinglesShopShowcase({
  singles,
  username,
  isOwner,
}: {
  singles: ShopSingle[];
  username: string;
  isOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const allInStock = useMemo(() => singles.filter((s) => s.quantity > 0), [singles]);

  // The game being previewed — the "TCG" dropdown next to the heading.
  // Distinct cards in stock per game, for the dropdown's counts; starts on
  // the game they stock the most of.
  const cardsByGame = useMemo(() => {
    const ids = new Map<string, Set<string>>();
    for (const s of allInStock) {
      if (!ids.has(s.game)) ids.set(s.game, new Set());
      ids.get(s.game)!.add(s.catalogCardId);
    }
    return new Map([...ids].map(([g, set]) => [g, set.size]));
  }, [allInStock]);
  const games = useMemo(
    () => [...new Set<string>([...ENABLED_GAMES, ...cardsByGame.keys()])],
    [cardsByGame],
  );
  const [game, setGame] = useState(
    () => [...games].sort((a, b) => (cardsByGame.get(b) ?? 0) - (cardsByGame.get(a) ?? 0))[0] ?? ENABLED_GAMES[0],
  );
  const inStock = useMemo(() => allInStock.filter((s) => s.game === game), [allInStock, game]);

  // One entry per card (its priciest variant), most expensive first.
  const featured = useMemo(() => {
    const best = new Map<string, ShopSingle>();
    for (const s of inStock) {
      const cur = best.get(s.catalogCardId);
      if (!cur || s.priceCents > cur.priceCents) best.set(s.catalogCardId, s);
    }
    return [...best.values()]
      .sort((a, b) => b.priceCents - a.priceCents || a.cardName.localeCompare(b.cardName))
      .slice(0, PREVIEW_COUNT);
  }, [inStock]);

  const cardCount = new Set(inStock.map((s) => s.catalogCardId)).size;
  const totalCards = [...cardsByGame.values()].reduce((n, c) => n + c, 0);
  const copyCount = inStock.reduce((n, s) => n + s.quantity, 0);
  const lowest = inStock.reduce((min, s) => Math.min(min, s.priceCents), Infinity);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (allInStock.length === 0 && !isOwner) return null;

  return (
    <section
      id="singles"
      className="relative scroll-mt-32 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 text-white shadow-lg"
    >
      {/* Soft gold spotlight behind the cards. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-brand-gold/20 blur-3xl"
      />

      <div className="relative p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gold/20 text-brand-gold-light ring-1 ring-brand-gold/40">
              <Store size={20} />
            </span>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Singles Shop</h2>
              {inStock.length > 0 ? (
                <p className="mt-0.5 text-sm text-white/60">
                  <span className="font-semibold text-white">{cardCount}</span> {cardCount === 1 ? "card" : "cards"} ·{" "}
                  <span className="font-semibold text-white">{copyCount}</span> {copyCount === 1 ? "copy" : "copies"} in
                  stock · from <span className="font-semibold text-brand-gold-light">{formatPrice(lowest)}</span>
                </p>
              ) : (
                <p className="mt-0.5 text-sm text-white/60">No {game} singles in stock.</p>
              )}
            </div>
            {/* Which game's singles are previewed — a dropdown, since the
                Singles Shop will cover many games. */}
            <label className="ml-1 flex items-center gap-2 self-center border-l border-white/15 pl-4 sm:ml-3 sm:pl-5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">TCG</span>
              <span className="relative">
                <select
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  aria-label="Game"
                  className="appearance-none rounded-full bg-white/10 py-1.5 pl-3.5 pr-9 text-sm font-semibold text-white ring-1 ring-white/20 outline-none transition-colors hover:bg-white/15 focus:ring-2 focus:ring-brand-gold-light/60"
                >
                  {games.map((g) => (
                    <option key={g} value={g} className="text-gray-900">
                      {g} ({cardsByGame.get(g) ?? 0})
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={15}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand-gold-light"
                />
              </span>
            </label>
          </div>
          {isOwner && (
            <Link
              href="/account/singles"
              className="flex items-center gap-1.5 rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10"
            >
              <Settings2 size={15} /> Manage Singles Shop
            </Link>
          )}
        </div>

        {featured.length > 0 ? (
          <>
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-gold-light/90">
              Top cards in this shop
            </p>
            <ul className="-mx-5 mt-3 flex snap-x gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 sm:pb-0">
              {featured.map((s) => (
                <li key={s.id} className="w-[38%] shrink-0 snap-start sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="group block w-full text-left"
                    aria-label={`${s.cardName}, ${formatPrice(s.priceCents)} — open the Singles Shop`}
                  >
                    <div className="relative aspect-[63/88] overflow-hidden rounded-xl bg-white/5 shadow-xl shadow-black/40 ring-1 ring-white/10 transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-2xl group-hover:ring-brand-gold/60">
                      {s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.imageUrl} alt={s.cardName} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-medium text-white/60">
                          {s.cardName}
                        </span>
                      )}
                      {/* Sheen that sweeps across on hover. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                      />
                    </div>
                    <div className="mt-2.5 px-0.5">
                      <p className="truncate text-sm font-semibold text-white">{s.cardName}</p>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2">
                        <span className="text-base font-bold text-brand-gold-light">{formatPrice(s.priceCents)}</span>
                        <span className="truncate text-[11px] text-white/50">
                          {CONDITION_SHORT[s.condition] ?? s.condition} · {s.isFoil ? "Foil" : "Non-foil"}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center">
              <p className="flex items-start gap-2 text-sm text-white/70">
                <PackagePlus size={17} className="mt-0.5 shrink-0 text-brand-gold-light" />
                <span>
                  {isOwner
                    ? "Buyers add these to any order from you at checkout — one shipment."
                    : `Buy or win any card from ${username}, then add these singles at checkout — they ship together.`}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="group flex shrink-0 items-center gap-2 rounded-full bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-gold/20 transition-all hover:bg-brand-gold-light hover:shadow-brand-gold/40"
              >
                Open Their Singles Shop
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </>
        ) : !isOwner || allInStock.length > 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-white/20 px-6 py-10 text-center">
            <p className="font-semibold">No {game} singles right now</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-white/60">Pick another game above to see what&apos;s in stock.</p>
          </div>
        ) : (
          isOwner && (
            <div className="mt-6 rounded-xl border border-dashed border-white/20 px-6 py-10 text-center">
              <p className="font-semibold">Your shop is empty</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-white/60">
                Stock Commons, Uncommons and Rares so buyers can add them to their orders.
              </p>
              <Link
                href="/account/singles"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-gold px-5 py-2 text-sm font-semibold text-white hover:bg-brand-gold-light"
              >
                Stock your shop <ArrowRight size={15} />
              </Link>
            </div>
          )
        )}
      </div>

      {/* Portaled to <body> so nothing on the page paints over it. */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={`${username}'s Singles Shop`}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-gray-950/50 backdrop-blur-[1px]"
            />
            <div className="relative flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-4 bg-gradient-to-r from-brand-navy to-brand-navy-light px-5 py-4 text-white">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gold/20 text-brand-gold-light">
                    <Store size={18} />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold leading-tight">{username}&apos;s Singles Shop</h2>
                    <p className="text-xs text-white/60">
                      {totalCards} {totalCards === 1 ? "card" : "cards"} in stock · add them at checkout when you buy a card
                      from {username}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="relative min-h-0 flex-1">
                {/* No onChange: browse-only. Listings are already on the
                    profile page, so the dialog shows singles only. */}
                <SinglesBrowser sellerName={username} singles={allInStock} listings={[]} initialGame={game} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
