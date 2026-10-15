"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, Layers, Loader2, Minus, Package, Plus, Search, ShoppingBag, Tag, X } from "lucide-react";
import ListingImage from "@/components/ListingImage";
import GamePicker from "@/components/singles/GamePicker";
import { FinishChip } from "@/components/singles/StockDrawer";
import {
  addonKey,
  withListingToggled,
  withSingleQty,
  type AddonSelection,
} from "@/components/checkout/addonSelection";
import { getCatalogSetCards, getCatalogSets, searchCatalogCards } from "@/lib/api";
import {
  CONDITION_SHORT,
  ENABLED_GAMES,
  formatPrice,
  type CatalogCard,
  type CatalogSetGroup,
  type Listing,
  type ShopSingle,
} from "@/lib/types";

// Pseudo-views in the left sidebar, alongside the real sets.
const IN_STOCK = "__in_stock__";
const IN_ORDER = "__in_order__";
const LISTINGS = "__listings__";

type Filter = "in_stock" | "all";

// The buyer's side of the Singles Shop, inside the "Add Singles To Your
// Order" dialog — the same Cardex-style layout the seller stocks it with
// (SinglesShopStudio): sets on the left, a search over the whole game, every
// card as its real image. Cards this seller has are full color with their
// price; cards they don't are greyed out. Click a card to add it (or pick a
// condition/foil when the seller has more than one).
//
// Without `onChange` it's browse-only — the seller profile's "Open Their
// Singles Shop" dialog: same layout, but clicking a card just shows its
// conditions/finishes, prices and stock (singles are only bought as add-ons
// at checkout).
const NO_SELECTION: AddonSelection = {};
const noop = () => {};

export default function SinglesBrowser({
  sellerName,
  singles,
  listings,
  selection = NO_SELECTION,
  onChange: onChangeProp,
  initialGame,
}: {
  sellerName: string;
  // The seller's in-stock singles (GET /users/{username}/singles).
  singles: ShopSingle[];
  // Their other Buy It Now listings.
  listings: Listing[];
  selection?: AddonSelection;
  onChange?: (next: AddonSelection) => void;
  // The game to open on (the profile preview's chosen game); defaults to
  // the game this seller stocks.
  initialGame?: string;
}) {
  const readOnly = onChangeProp === undefined;
  const onChange = onChangeProp ?? noop;
  // Every game the Singles Shop is open for, chosen at the top of the
  // sidebar like the seller's studio. Starts on the game this seller
  // actually stocks.
  const games = ENABLED_GAMES;
  const [game, setGame] = useState(initialGame ?? singles[0]?.game ?? ENABLED_GAMES[0]);
  const gameSingles = useMemo(() => singles.filter((s) => s.game === game), [singles, game]);

  const [groups, setGroups] = useState<CatalogSetGroup[]>([]);
  useEffect(() => {
    // Ignore a slow response for a game the buyer already switched away from.
    let current = true;
    getCatalogSets(game).then((g) => {
      if (!current) return;
      setGroups(
        g
          .map((grp) => ({ ...grp, sets: grp.sets.filter((s) => s.singlesCount > 0) }))
          .filter((grp) => grp.sets.length > 0),
      );
    });
    return () => {
      current = false;
    };
  }, [game]);

  const [view, setView] = useState<string>(singles.length > 0 ? IN_STOCK : LISTINGS);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openCard, setOpenCard] = useState<CatalogCard | null>(null);

  // --- The seller's stock, by catalog card and by set ---
  const stockByCard = useMemo(() => {
    const map = new Map<string, ShopSingle[]>();
    for (const s of gameSingles) {
      if (s.quantity <= 0) continue;
      map.set(s.catalogCardId, [...(map.get(s.catalogCardId) ?? []), s]);
    }
    for (const list of map.values()) list.sort((a, b) => a.priceCents - b.priceCents || conditionRank(a) - conditionRank(b));
    return map;
  }, [gameSingles]);
  const stockBySet = useMemo(() => {
    const map = new Map<string, number>();
    for (const [, list] of stockByCard) map.set(list[0].setName, (map.get(list[0].setName) ?? 0) + 1);
    return map;
  }, [stockByCard]);

  // Copies of each catalog card currently in the order.
  const inOrderByCard = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of singles) {
      const qty = selection[addonKey("single", s.id)]?.quantity ?? 0;
      if (qty > 0) map.set(s.catalogCardId, (map.get(s.catalogCardId) ?? 0) + qty);
    }
    return map;
  }, [singles, selection]);
  const listingsInOrder = listings.filter((l) => selection[addonKey("listing", l.id)]).length;
  // Total copies in the order (two of the same card count as two), for the
  // "In your order" badge — matches the footer's "N cards added".
  let copiesInOrder = listingsInOrder;
  for (const n of inOrderByCard.values()) copiesInOrder += n;

  // Catalog-shaped cards built from the shop's own snapshot fields, for the
  // "In stock" / "In your order" views — no catalog fetch needed.
  const stockCards = useMemo(() => {
    const cards: CatalogCard[] = [];
    for (const [id, list] of stockByCard) {
      const s = list[0];
      cards.push({
        id,
        name: s.cardName,
        set: "",
        setName: s.setName,
        number: s.cardNumber,
        displayNumber: s.cardNumber,
        rarity: s.rarity ?? "",
        singlesEligible: true,
        game: s.game,
        imageUrl: s.imageUrl ?? "",
        tags: null,
        hidden: false,
      });
    }
    return cards.sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name));
  }, [stockByCard]);

  // --- Per-set card lists, cached for the dialog's lifetime ---
  const [setCards, setSetCards] = useState<Record<string, CatalogCard[]>>({});
  const [setError, setSetError] = useState("");
  const loading = useRef(new Set<string>());
  const loadSet = useCallback(
    (name: string) => {
      const key = `${game}::${name}`;
      if (setCards[key] || loading.current.has(key)) return;
      loading.current.add(key);
      getCatalogSetCards(game, name)
        .then((cards) => setSetCards((prev) => ({ ...prev, [key]: cards.filter((c) => c.singlesEligible) })))
        .catch((err) => setSetError(err instanceof Error ? err.message : "Couldn't load this set."))
        .finally(() => loading.current.delete(key));
    },
    [game, setCards],
  );
  const isSetView = view !== IN_STOCK && view !== IN_ORDER && view !== LISTINGS;
  useEffect(() => {
    if (isSetView) loadSet(view);
  }, [view, isSetView, loadSet]);

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
          if (id === searchId.current) setResults(cards.filter((c) => c.singlesEligible).slice(0, 150));
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
  const baseCards = useMemo<CatalogCard[] | undefined>(
    () =>
      searching
        ? results
        : view === IN_STOCK
          ? stockCards
          : view === IN_ORDER
            ? stockCards.filter((c) => inOrderByCard.has(c.id))
            : view === LISTINGS
              ? []
              : setCards[`${game}::${view}`],
    [searching, results, view, stockCards, inOrderByCard, setCards, game],
  );
  const gridCards = useMemo(() => {
    if (!baseCards) return undefined;
    if (filter === "all" || view === IN_STOCK || view === IN_ORDER) return baseCards;
    return baseCards.filter((c) => stockByCard.has(c.id));
  }, [baseCards, filter, view, stockByCard]);
  const gridLoading = searching ? searchLoading && results.length === 0 : isSetView && !setCards[`${game}::${view}`];

  function switchGame(next: string) {
    if (next === game) return;
    setGame(next);
    setGroups([]);
    setQuery("");
    setView(IN_STOCK);
  }

  function go(next: string) {
    setView(next);
    setQuery("");
  }

  // Clicking a card: one variant on offer -> add a copy straight away;
  // several (conditions/foil) -> let the buyer pick.
  function clickCard(card: CatalogCard) {
    const variants = stockByCard.get(card.id);
    if (!variants) return;
    if (!readOnly && variants.length === 1 && !inOrderByCard.has(card.id)) {
      onChange(withSingleQty(selection, variants[0], 1));
      return;
    }
    setOpenCard(card);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left: views + sets ─────────────────────────────────────── */}
      <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-brand-border bg-brand-surface/50 p-3 md:block">
        <GamePicker
          games={games}
          value={game}
          onChange={switchGame}
          countFor={(g) => new Set(singles.filter((s) => s.game === g && s.quantity > 0).map((s) => s.catalogCardId)).size}
        />
        <SidebarItem
          active={view === IN_STOCK && !searching}
          onClick={() => go(IN_STOCK)}
          icon={<Package size={14} />}
          label="In stock"
          badge={stockCards.length}
          highlight={false}
        />
        {!readOnly && (
        <SidebarItem
          active={view === IN_ORDER && !searching}
          onClick={() => go(IN_ORDER)}
          icon={<ShoppingBag size={14} />}
          label="In your order"
          badge={copiesInOrder}
          highlight={copiesInOrder > 0}
        />
        )}
        {listings.length > 0 && (
          <SidebarItem
            active={view === LISTINGS && !searching}
            onClick={() => go(LISTINGS)}
            icon={<Tag size={14} />}
            label="Buy It Now listings"
            badge={listings.length}
            highlight={false}
          />
        )}

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
                  const inStock = stockBySet.get(set.name) ?? 0;
                  return (
                    <SidebarItem
                      key={set.name}
                      active={view === set.name && !searching}
                      onClick={() => go(set.name)}
                      code={set.code}
                      label={set.label}
                      badge={inStock}
                      highlight={inStock > 0}
                      dim={inStock === 0}
                      title={`${sellerName} has ${inStock} ${inStock === 1 ? "card" : "cards"} from ${set.label}`}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </aside>

      {/* ── Right: search, header, grid ────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-brand-border px-5 py-3 sm:flex-row sm:items-center">
          {/* The sidebar is hidden on small screens — same choices here. */}
          <select
            value={game}
            onChange={(e) => switchGame(e.target.value)}
            aria-label="Game"
            className="rounded-full border border-gray-300 bg-white px-3 py-2 text-sm md:hidden"
          >
            {games.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={view}
            onChange={(e) => go(e.target.value)}
            aria-label="Browse"
            className="rounded-full border border-gray-300 bg-white px-3 py-2 text-sm md:hidden"
          >
            <option value={IN_STOCK}>In stock</option>
            {!readOnly && <option value={IN_ORDER}>In your order</option>}
            {listings.length > 0 && <option value={LISTINGS}>Buy It Now listings</option>}
            {groups.flatMap((g) => g.sets).map((s) => (
              <option key={s.name} value={s.name}>
                {s.label} ({stockBySet.get(s.name) ?? 0} in stock)
              </option>
            ))}
          </select>
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search every ${game} card, e.g. "Rengar"`}
              className="w-full rounded-full border border-gray-300 bg-white py-2 pl-10 pr-10 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
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
          {(isSetView || searching) && (
            <div className="flex shrink-0 rounded-full border border-gray-300 bg-white p-0.5 text-xs font-semibold">
              {(
                [
                  ["all", "All cards"],
                  ["in_stock", "In stock"],
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
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 flex items-center gap-2 text-sm text-gray-600">
            {searching ? (
              searchLoading && results.length === 0 ? (
                "Searching..."
              ) : (
                <>
                  <span className="font-semibold text-gray-900">{gridCards?.length ?? 0}</span>{" "}
                  {gridCards?.length === 1 ? "card matches" : "cards match"} &ldquo;{q}&rdquo;
                </>
              )
            ) : view === IN_STOCK ? (
              <>
                <Package size={15} /> Everything {sellerName} has in stock
              </>
            ) : view === IN_ORDER ? (
              <>
                <ShoppingBag size={15} /> What you&apos;ve added to this order
              </>
            ) : view === LISTINGS ? (
              <>
                <Tag size={15} /> More from {sellerName} · Buy It Now
              </>
            ) : activeSet ? (
              <>
                <Layers size={15} /> <span className="font-semibold text-gray-900">{activeSet.label}</span>
                <span className="text-gray-400">
                  · {sellerName} has {stockBySet.get(activeSet.name) ?? 0} of {activeSet.singlesCount}
                </span>
              </>
            ) : null}
          </p>

          {view === LISTINGS && !searching ? (
            <ListingsGrid listings={listings} selection={selection} onChange={onChange} />
          ) : setError && isSetView && !searching && !setCards[`${game}::${view}`] ? (
            <EmptyState title="Couldn't load this set" body={setError} />
          ) : gridLoading ? (
            <SkeletonGrid />
          ) : gridCards && gridCards.length > 0 ? (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(122px,1fr))]">
                {gridCards.map((card) => (
                  <BuyerCardTile
                    key={card.id}
                    card={card}
                    variants={stockByCard.get(card.id)}
                    inOrder={inOrderByCard.get(card.id) ?? 0}
                    selection={selection}
                    onChange={onChange}
                    onClick={() => clickCard(card)}
                    onChoose={() => setOpenCard(card)}
                    readOnly={readOnly}
                    showSet={searching || view === IN_STOCK || view === IN_ORDER}
                  />
                ))}
              </div>
              {view === IN_ORDER && listingsInOrder > 0 && (
                <div className="mt-6">
                  <ListingsGrid
                    listings={listings.filter((l) => selection[addonKey("listing", l.id)])}
                    selection={selection}
                    onChange={onChange}
                  />
                </div>
              )}
            </>
          ) : view === IN_ORDER && listingsInOrder > 0 ? (
            <ListingsGrid
              listings={listings.filter((l) => selection[addonKey("listing", l.id)])}
              selection={selection}
              onChange={onChange}
            />
          ) : view === IN_ORDER ? (
            <EmptyState title="Nothing added yet" body="Pick a set on the left or search, then click a card to add it." />
          ) : searching ? (
            <EmptyState
              title={filter === "in_stock" ? `${sellerName} doesn't have a card matching “${q}”` : `No cards match “${q}”`}
              body="Try a shorter name."
            />
          ) : (
            <EmptyState
              title={`${sellerName} doesn't have any cards from this set`}
              body="Switch to “All cards” to browse the set, or pick another set on the left."
            />
          )}
        </div>
      </section>

      {openCard && (
        <VariantSheet
          card={openCard}
          variants={stockByCard.get(openCard.id) ?? []}
          selection={selection}
          onChange={onChange}
          readOnly={readOnly}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
}

// "Non-foil or Foil" when the only difference is the finish (the common
// Riftbound case for Commons/Uncommons), otherwise "N options".
function optionsLabel(variants: ShopSingle[]): string {
  const oneCondition = variants.every((v) => v.condition === variants[0].condition);
  const finishes = new Set(variants.map((v) => v.isFoil));
  return oneCondition && finishes.size === 2 ? "Non-foil or Foil" : `${variants.length} options`;
}

function conditionRank(s: ShopSingle): number {
  return ["Near Mint", "Lightly Played", "Moderately Played"].indexOf(s.condition) * 2 + Number(s.isFoil);
}

// One card in the grid: full color with its price if the seller has it,
// greyed out if they don't. A card with one variant on offer gets an inline
// Add / stepper; several variants get a "Choose" that opens VariantSheet.
function BuyerCardTile({
  card,
  variants,
  inOrder,
  selection,
  onChange,
  onClick,
  onChoose,
  readOnly,
  showSet,
}: {
  card: CatalogCard;
  variants?: ShopSingle[];
  inOrder: number;
  selection: AddonSelection;
  onChange: (next: AddonSelection) => void;
  onClick: () => void;
  onChoose: () => void;
  readOnly: boolean;
  showSet: boolean;
}) {
  const available = Boolean(variants && variants.length > 0);
  const number = card.displayNumber || card.number;
  const only = variants?.length === 1 ? variants[0] : undefined;
  const onlyQty = only ? (selection[addonKey("single", only.id)]?.quantity ?? 0) : 0;
  const totalLeft = variants?.reduce((n, v) => n + v.quantity, 0) ?? 0;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={!available}
        title={available ? undefined : "Not in this seller's shop"}
        className={`group relative aspect-[5/7] w-full overflow-hidden rounded-lg bg-brand-surface transition-all duration-200 ${
          inOrder > 0
            ? "shadow-md ring-2 ring-brand-gold"
            : available
              ? "ring-1 ring-gray-200 hover:-translate-y-0.5 hover:shadow-md"
              : "cursor-default ring-1 ring-gray-200"
        }`}
      >
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.imageUrl}
            alt={card.name}
            loading="lazy"
            className={`h-full w-full object-cover ${available ? "" : "opacity-30 grayscale"}`}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-semibold text-gray-400">
            {card.name}
          </span>
        )}
        {inOrder > 0 && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-brand-gold px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow">
            <Check size={10} strokeWidth={3} /> {inOrder}
          </span>
        )}
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold leading-none text-white/90">
          #{number}
        </span>
        {available && inOrder === 0 && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex items-center gap-1 rounded-full bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              {readOnly ? (
                <>
                  <Eye size={13} /> View
                </>
              ) : (
                <>
                  <Plus size={13} /> {only ? "Add" : "Choose"}
                </>
              )}
            </span>
          </span>
        )}
      </button>

      <div className="min-w-0 px-0.5">
        <p className={`truncate text-xs font-semibold ${available ? "text-gray-900" : "text-gray-400"}`}>{card.name}</p>
        <p className="truncate text-[11px] text-gray-400">
          {available ? (
            <>
              <span className="font-bold text-gray-900">
                {variants!.length > 1 && "from "}
                {formatPrice(variants![0].priceCents)}
              </span>{" "}
              · {totalLeft} left
            </>
          ) : (
            "Not in stock"
          )}
          {showSet && <> · {card.setCode || card.setName}</>}
        </p>
      </div>

      {available &&
        !readOnly &&
        (only ? (
          onlyQty === 0 ? (
            <button
              type="button"
              onClick={() => onChange(withSingleQty(selection, only, 1))}
              className="flex items-center justify-center gap-1 rounded-full border border-brand-navy py-1 text-xs font-semibold text-brand-navy transition-colors hover:bg-brand-navy hover:text-white"
            >
              <Plus size={12} /> Add
            </button>
          ) : (
            <Stepper
              value={onlyQty}
              max={only.quantity}
              label={card.name}
              onChange={(n) => onChange(withSingleQty(selection, only, n))}
            />
          )
        ) : (
          <button
            type="button"
            onClick={onChoose}
            className={`rounded-full py-1 text-xs font-semibold transition-colors ${
              inOrder > 0
                ? "bg-brand-navy text-white hover:bg-brand-navy/90"
                : "border border-brand-navy text-brand-navy hover:bg-brand-navy hover:text-white"
            }`}
          >
            {inOrder > 0 ? "Edit" : optionsLabel(variants!)}
          </button>
        ))}
    </div>
  );
}

// Every variant (condition/foil) the seller has of one card, each with its
// own quantity — slides over the dialog's right edge.
function VariantSheet({
  card,
  variants,
  selection,
  onChange,
  readOnly,
  onClose,
}: {
  card: CatalogCard;
  variants: ShopSingle[];
  selection: AddonSelection;
  onChange: (next: AddonSelection) => void;
  readOnly: boolean;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-gray-950/20" />
      <div className="relative flex h-full w-full max-w-sm flex-col overflow-y-auto border-l border-brand-border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-brand-border px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-gold">{card.setName}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-brand-surface hover:text-gray-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-4 px-5 pt-5">
          {card.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.imageUrl} alt={card.name} className="aspect-[5/7] w-28 shrink-0 rounded-xl object-cover shadow-lg" />
          )}
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-tight text-gray-900">{card.name}</h3>
            <p className="mt-1 text-sm text-gray-500">
              #{card.displayNumber || card.number}
              {card.rarity && <> · {card.rarity}</>}
            </p>
          </div>
        </div>
        <ul className="mt-5 flex flex-col gap-2 px-5 pb-5">
          {variants.map((v) => {
            const qty = selection[addonKey("single", v.id)]?.quantity ?? 0;
            return (
              <li
                key={v.id}
                className={`flex items-center gap-2 rounded-lg border p-2.5 ${qty > 0 ? "border-brand-gold bg-amber-50/40" : "border-brand-border"}`}
              >
                <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[11px] font-bold text-white" title={v.condition}>
                  {CONDITION_SHORT[v.condition] ?? v.condition}
                </span>
                <FinishChip foil={v.isFoil} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-bold text-gray-900">{formatPrice(v.priceCents)}</span>
                  <span className="text-xs text-gray-400"> · {v.quantity} left</span>
                </span>
                {readOnly ? null : qty === 0 ? (
                  <button
                    type="button"
                    onClick={() => onChange(withSingleQty(selection, v, 1))}
                    className="flex items-center gap-1 rounded-full border border-brand-navy px-3 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy hover:text-white"
                  >
                    <Plus size={12} /> Add
                  </button>
                ) : (
                  <div className="w-24">
                    <Stepper value={qty} max={v.quantity} label={card.name} onChange={(n) => onChange(withSingleQty(selection, v, n))} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {readOnly && (
          <p className="mx-5 mb-5 rounded-lg bg-brand-surface px-3 py-2.5 text-xs leading-relaxed text-gray-600">
            Singles ship with a card you buy or win from this seller — add them on the checkout page.
          </p>
        )}
      </div>
    </div>
  );
}

function ListingsGrid({
  listings,
  selection,
  onChange,
}: {
  listings: Listing[];
  selection: AddonSelection;
  onChange: (next: AddonSelection) => void;
}) {
  if (listings.length === 0) {
    return <EmptyState title="No other Buy It Now listings" body="This seller doesn't have other fixed-price cards right now." />;
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
      {listings.map((l) => {
        const added = Boolean(selection[addonKey("listing", l.id)]);
        return (
          <li key={l.id} className="flex flex-col gap-1.5">
            <div
              className={`relative aspect-square overflow-hidden rounded-lg bg-brand-surface ring-2 transition ${
                added ? "ring-brand-gold" : "ring-transparent"
              }`}
            >
              <ListingImage src={l.imageUrls?.[0]} label={l.title} game={l.game} sizes="200px" />
            </div>
            <p className="line-clamp-2 text-xs font-semibold text-gray-900">{l.title}</p>
            <p className="text-xs font-bold text-gray-900">{formatPrice(l.priceCents ?? 0)}</p>
            <button
              type="button"
              onClick={() => onChange(withListingToggled(selection, l))}
              className={`flex items-center justify-center gap-1 rounded-full py-1 text-xs font-semibold transition-colors ${
                added
                  ? "bg-brand-navy text-white hover:bg-brand-navy/90"
                  : "border border-brand-navy text-brand-navy hover:bg-brand-navy hover:text-white"
              }`}
            >
              {added ? (
                <>
                  <Check size={12} /> Added
                </>
              ) : (
                <>
                  <Plus size={12} /> Add
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Stepper({
  value,
  max,
  label,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-full bg-brand-navy px-1 py-0.5 text-white">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        className="rounded-full p-1 hover:bg-white/15"
        aria-label={`Remove one ${label}`}
      >
        <Minus size={12} />
      </button>
      <span className="text-xs font-bold">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        className="rounded-full p-1 hover:bg-white/15 disabled:opacity-30"
        aria-label={`Add another ${label}`}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

function SidebarItem({
  active,
  onClick,
  icon,
  code,
  label,
  badge,
  highlight,
  dim,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  code?: string;
  label: string;
  badge: number;
  highlight: boolean;
  dim?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-brand-navy text-white" : dim ? "text-gray-400 hover:bg-white" : "text-gray-700 hover:bg-white"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {code && <span className={`text-[10px] font-bold ${active ? "text-white/60" : "text-gray-400"}`}>{code}</span>}
      <span
        className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${
          highlight ? "bg-brand-gold text-white" : active ? "bg-white/15 text-white/80" : "bg-white text-gray-400"
        }`}
      >
        {badge}
      </span>
    </button>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(122px,1fr))]">
      {Array.from({ length: 12 }, (_, i) => (
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="mt-1 max-w-md text-sm text-gray-500">{body}</p>
    </div>
  );
}
