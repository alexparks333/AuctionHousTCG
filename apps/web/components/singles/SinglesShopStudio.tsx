"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, Loader2, Package, Search, X } from "lucide-react";
import ShopCardTile, { type CardStock } from "@/components/singles/ShopCardTile";
import StockDrawer from "@/components/singles/StockDrawer";
import GamePicker from "@/components/singles/GamePicker";
import { getCatalogSetCards, getCatalogSets, searchCatalogCards } from "@/lib/api";
import { SINGLES_RARITIES, formatPrice, type CatalogCard, type CatalogSetGroup, type ShopSingle } from "@/lib/types";

// The pseudo-set showing everything the seller stocks, across every set.
const STOCK_VIEW = "__stock__";

type Filter = "all" | "selling" | "not_selling";

// The Singles Shop, modeled on TCG Haven's Cardex: pick a game and a set on
// the left, see every card in that set as its real card image — full color
// if you're selling it, greyed out if you aren't — and click any card to
// stock it or edit what you have. The search bar searches every card in the
// game, not just the open set, since a seller usually knows the card name
// before they know which set it's from.
export default function SinglesShopStudio({
  games,
  initialGame,
  initialGroups,
  initialSingles,
}: {
  // Enabled games that have a catalog to pick from.
  games: string[];
  initialGame: string;
  initialGroups: CatalogSetGroup[];
  initialSingles: ShopSingle[];
}) {
  const [game, setGame] = useState(initialGame);
  const [allGroups, setGroups] = useState(initialGroups);
  // Sets with nothing a Singles Shop can stock (all chase prints, e.g. Metal
  // Cards) aren't worth showing at all.
  const groups = useMemo(
    () =>
      allGroups
        .map((g) => ({ ...g, sets: g.sets.filter((s) => s.singlesCount > 0) }))
        .filter((g) => g.sets.length > 0),
    [allGroups],
  );
  const [singles, setSingles] = useState(initialSingles);
  const [view, setView] = useState<string>(() =>
    initialSingles.length > 0 ? STOCK_VIEW : (initialGroups[0]?.sets[0]?.name ?? STOCK_VIEW),
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openCard, setOpenCard] = useState<CatalogCard | null>(null);

  // Per-set card lists, cached for the session so flipping between sets is
  // instant after the first visit.
  const [setCards, setSetCards] = useState<Record<string, CatalogCard[]>>({});
  const [setError, setSetError] = useState("");
  const loadingSets = useRef(new Set<string>());

  const loadSet = useCallback(
    (name: string) => {
      const key = `${game}::${name}`;
      if (setCards[key] || loadingSets.current.has(key)) return;
      loadingSets.current.add(key);
      getCatalogSetCards(game, name)
        .then((cards) => setSetCards((prev) => ({ ...prev, [key]: cards })))
        .catch((err) => setSetError(err instanceof Error ? err.message : "Couldn't load this set."))
        .finally(() => loadingSets.current.delete(key));
    },
    [game, setCards],
  );

  useEffect(() => {
    if (view !== STOCK_VIEW) loadSet(view);
  }, [view, loadSet]);

  function switchGame(next: string) {
    if (next === game) return;
    setGame(next);
    setGroups([]);
    setView(STOCK_VIEW);
    getCatalogSets(next).then(setGroups);
  }

  // --- The seller's stock, indexed by catalog card ---
  const gameSingles = useMemo(() => singles.filter((s) => s.game === game), [singles, game]);
  const stockByCard = useMemo(() => {
    const map = new Map<string, CardStock>();
    for (const s of gameSingles) {
      const cur = map.get(s.catalogCardId) ?? { quantity: 0, variants: 0 };
      cur.quantity += s.quantity;
      cur.variants += 1;
      if (s.quantity > 0 && (cur.fromCents === undefined || s.priceCents < cur.fromCents)) cur.fromCents = s.priceCents;
      map.set(s.catalogCardId, cur);
    }
    return map;
  }, [gameSingles]);
  const sellingBySet = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of gameSingles) {
      if (s.quantity <= 0) continue;
      if (!map.has(s.setName)) map.set(s.setName, new Set());
      map.get(s.setName)!.add(s.catalogCardId);
    }
    return map;
  }, [gameSingles]);

  const totals = useMemo(() => {
    let copies = 0;
    let value = 0;
    for (const s of gameSingles) {
      copies += s.quantity;
      value += s.quantity * s.priceCents;
    }
    const cards = new Set(gameSingles.filter((s) => s.quantity > 0).map((s) => s.catalogCardId)).size;
    return { cards, copies, value };
  }, [gameSingles]);

  // "Your stock" as catalog-shaped cards (one per distinct card), built
  // from the shop's own snapshot fields so it renders with no catalog fetch.
  const stockCards = useMemo(() => {
    const seen = new Map<string, CatalogCard>();
    for (const s of gameSingles) {
      if (seen.has(s.catalogCardId)) continue;
      seen.set(s.catalogCardId, {
        id: s.catalogCardId,
        name: s.cardName,
        set: "",
        setName: s.setName,
        number: s.cardNumber,
        displayNumber: s.cardNumber,
        rarity: s.rarity ?? "",
        singlesEligible: SINGLES_RARITIES.includes(s.rarity ?? ""),
        game: s.game,
        imageUrl: s.imageUrl ?? "",
        tags: null,
        hidden: false,
      });
    }
    return [...seen.values()].sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name));
  }, [gameSingles]);

  // --- Search across the whole game ---
  const q = query.trim();
  const searching = q.length >= 2;
  const [results, setResults] = useState<CatalogCard[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchId = useRef(0);
  useEffect(() => {
    const id = ++searchId.current;
    if (!searching) return;
    const timer = setTimeout(() => {
      setSearchLoading(true);
      searchCatalogCards(game, q)
        .then((cards) => {
          if (id === searchId.current) setResults(cards.slice(0, 150));
        })
        .catch(() => {
          if (id === searchId.current) setResults([]);
        })
        .finally(() => {
          if (id === searchId.current) setSearchLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, searching, game]);

  // --- What the grid shows ---
  const activeSet = groups.flatMap((g) => g.sets).find((s) => s.name === view);
  const currentSetCards = view === STOCK_VIEW ? stockCards : setCards[`${game}::${view}`];
  const rawCards = searching ? results : currentSetCards;
  // Only Commons/Uncommons/Rares go in the Singles Shop — chase prints are
  // left out of the grid. "Your
  // stock" shows everything the seller has, eligible or not.
  const baseCards = useMemo(
    () => (searching || view !== STOCK_VIEW ? rawCards?.filter((c) => c.singlesEligible) : rawCards),
    [rawCards, view, searching],
  );
  const gridCards = useMemo(() => {
    if (!baseCards) return undefined;
    if (filter === "all") return baseCards;
    return baseCards.filter((c) => {
      const selling = (stockByCard.get(c.id)?.quantity ?? 0) > 0;
      return filter === "selling" ? selling : !selling;
    });
  }, [baseCards, filter, stockByCard]);
  const gridLoading = searching ? searchLoading && results.length === 0 : !currentSetCards;

  // Market prices for a card opened from "Your stock" (built from the shop's
  // snapshot, which doesn't carry them) — fill them in from the set's real
  // catalog list once it's loaded.
  const openCardFull = useMemo(() => {
    if (!openCard || openCard.marketPrice !== undefined) return openCard;
    const full = setCards[`${game}::${openCard.setName}`]?.find((c) => c.id === openCard.id);
    return full ?? openCard;
  }, [openCard, setCards, game]);
  function open(card: CatalogCard) {
    setOpenCard(card);
    if (card.marketPrice === undefined && card.setName) loadSet(card.setName);
  }

  function upsertSingle(next: ShopSingle) {
    setSingles((prev) => [...prev.filter((s) => s.id !== next.id), next]);
  }

  const sellingInView = activeSet ? (sellingBySet.get(activeSet.name)?.size ?? 0) : 0;
  const pct =
    activeSet && activeSet.singlesCount > 0 ? Math.round((sellingInView / activeSet.singlesCount) * 100) : 0;

  return (
    <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* ── Left: game + set picker ─────────────────────────────────── */}
      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto">
        <div className="rounded-xl border border-brand-border bg-white p-3">
          <GamePicker
            games={games}
            value={game}
            onChange={switchGame}
            countFor={(g) => new Set(singles.filter((s) => s.game === g && s.quantity > 0).map((s) => s.catalogCardId)).size}
          />

          <SidebarItem
            active={view === STOCK_VIEW && !searching}
            onClick={() => {
              setView(STOCK_VIEW);
              setQuery("");
            }}
            icon={<Package size={14} />}
            label="Your stock"
            badge={totals.cards}
            highlight={totals.cards > 0}
          />

          {groups.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 px-2 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Loading sets...
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mt-4">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group.label}</p>
                <div className="mt-1 flex flex-col gap-0.5">
                  {group.sets.map((set) => {
                    const selling = sellingBySet.get(set.name)?.size ?? 0;
                    return (
                      <SidebarItem
                        key={set.name}
                        active={view === set.name && !searching}
                        onClick={() => {
                          setView(set.name);
                          setQuery("");
                        }}
                        code={set.code}
                        label={set.label}
                        badge={selling > 0 ? selling : set.singlesCount}
                        highlight={selling > 0}
                        title={
                          selling > 0
                            ? `Selling ${selling} of ${set.singlesCount} cards`
                            : `${set.singlesCount} Commons, Uncommons & Rares`
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 rounded-xl border border-brand-border bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Your shop</p>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Stat label="Cards" value={String(totals.cards)} />
            <Stat label="Copies" value={String(totals.copies)} />
            <Stat label="Listed" value={formatPrice(totals.value)} />
          </dl>
        </div>
      </aside>

      {/* ── Right: search, set header, card grid ────────────────────── */}
      <section className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 -mx-1 flex flex-col gap-3 bg-brand-surface/95 px-1 pb-3 pt-1 backdrop-blur sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search every ${game} card, e.g. "Rengar" or "Jinx 66"`}
              className="w-full rounded-full border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-sm shadow-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-700"
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div className="flex shrink-0 rounded-full border border-gray-300 bg-white p-0.5 text-xs font-semibold">
            {(
              [
                ["all", "All cards"],
                ["selling", "Selling"],
                ["not_selling", "Not selling"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full px-3 py-1.5 transition-colors ${
                  filter === value ? "bg-brand-navy text-white" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Header for whatever the grid is showing */}
        <div className="mb-4 rounded-xl border border-brand-border bg-white px-4 py-3">
          {searching ? (
            <p className="text-sm text-gray-600">
              {searchLoading && results.length === 0 ? (
                "Searching..."
              ) : (
                <>
                  <span className="font-semibold text-gray-900">{baseCards?.length ?? 0}</span>{" "}
                  {baseCards?.length === 1 ? "card matches" : "cards match"} &ldquo;{q}&rdquo; across every {game} set
                </>
              )}
            </p>
          ) : view === STOCK_VIEW ? (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="flex items-center gap-2 text-base font-bold text-gray-900">
                <Package size={16} /> Your stock
              </p>
              <p className="text-sm text-gray-500">
                {totals.cards} {totals.cards === 1 ? "card" : "cards"} · {totals.copies} {totals.copies === 1 ? "copy" : "copies"} ·{" "}
                {formatPrice(totals.value)} listed
              </p>
            </div>
          ) : activeSet ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="flex items-center gap-2 text-base font-bold text-gray-900">
                  <Layers size={16} /> {activeSet.label}
                  {activeSet.code && (
                    <span className="rounded bg-brand-surface px-1.5 py-0.5 text-[11px] font-bold text-gray-500">{activeSet.code}</span>
                  )}
                </p>
                <p className="text-sm text-gray-500">
                  Selling <span className="font-bold text-brand-gold">{sellingInView}</span> of {activeSet.singlesCount} cards
                  <span className="ml-1 text-xs text-gray-400">({pct}%)</span>
                </p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-surface">
                <div className="h-full rounded-full bg-brand-gold transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : null}
        </div>

        {setError && !searching && view !== STOCK_VIEW && !currentSetCards ? (
          <EmptyState title="Couldn't load this set" body={setError} />
        ) : gridLoading ? (
          <SkeletonGrid />
        ) : gridCards && gridCards.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))]">
            {gridCards.map((card) => (
              <ShopCardTile
                key={card.id}
                card={card}
                stock={stockByCard.get(card.id)}
                showSet={searching || view === STOCK_VIEW}
                onOpen={open}
              />
            ))}
          </div>
        ) : view === STOCK_VIEW && !searching && stockCards.length === 0 ? (
          <EmptyState
            title="Your Singles Shop is empty"
            body="Pick a set on the left (or search above), then click any card to start selling it. Buyers can add your singles to any order from you at checkout."
          />
        ) : searching ? (
          <EmptyState title={`No ${game} cards match “${q}”`} body="Try a shorter name, or add the card number, e.g. “Jinx 66”." />
        ) : (
          <EmptyState
            title={filter === "selling" ? "You're not selling any cards here yet" : "You're selling every card here"}
            body={filter === "selling" ? "Switch to “All cards” and click a card to start selling it." : "Nice. Switch to “All cards” to see them."}
          />
        )}
      </section>

      <StockDrawer
        card={openCardFull}
        game={game}
        variants={openCard ? gameSingles.filter((s) => s.catalogCardId === openCard.id).sort(variantOrder) : []}
        onClose={() => setOpenCard(null)}
        onSaved={upsertSingle}
        onRemoved={(id) => setSingles((prev) => prev.filter((s) => s.id !== id))}
      />
    </div>
  );
}

const CONDITION_RANK: Record<string, number> = {
  "Near Mint": 0,
  "Lightly Played": 1,
  "Moderately Played": 2,
  "Heavily Played": 3,
  Damaged: 4,
};

function variantOrder(a: ShopSingle, b: ShopSingle): number {
  return (CONDITION_RANK[a.condition] ?? 9) - (CONDITION_RANK[b.condition] ?? 9) || Number(a.isFoil) - Number(b.isFoil);
}

function SidebarItem({
  active,
  onClick,
  icon,
  code,
  label,
  badge,
  highlight,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  code?: string;
  label: string;
  badge: number;
  highlight: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-brand-navy text-white" : "text-gray-700 hover:bg-brand-surface"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {code && <span className={`text-[10px] font-bold ${active ? "text-white/60" : "text-gray-400"}`}>{code}</span>}
      <span
        className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${
          highlight
            ? "bg-brand-gold text-white"
            : active
              ? "bg-white/15 text-white/80"
              : "bg-brand-surface text-gray-400"
        }`}
      >
        {badge}
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="text-sm font-bold text-gray-900">{value}</dd>
      <dt className="text-[10px] text-gray-400">{label}</dt>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))]">
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="aspect-[5/7] animate-pulse rounded-lg bg-gray-200/70" />
          <div className="h-2.5 w-3/4 animate-pulse rounded bg-gray-200/70" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="mt-1 max-w-md text-sm text-gray-500">{body}</p>
    </div>
  );
}
