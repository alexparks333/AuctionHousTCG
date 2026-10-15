"use client";

import { Plus } from "lucide-react";
import { formatPrice, isFoilOnly, marketPriceCents, singlesPriceCents, type CatalogCard } from "@/lib/types";

// What the seller has of one catalog card across every condition/foil
// variant in their Singles Shop.
export interface CardStock {
  // Copies currently for sale (sum of every variant's quantity).
  quantity: number;
  // Variants stocked at all, including sold-out ones.
  variants: number;
  // Cheapest in-stock variant's price.
  fromCents?: number;
}

// One card in the Singles Shop grid, styled after TCG Haven's Cardex: a
// card you're selling is full color with a gold ring and a ×N badge; one
// you're not is greyed out (like an uncollected Cardex card) and shows an
// "Add" affordance on hover. A card you stocked but sold out of stays grey
// with a "Sold out" marker so it's easy to find and restock.
export default function ShopCardTile({
  card,
  stock,
  showSet,
  onOpen,
}: {
  card: CatalogCard;
  stock?: CardStock;
  // In search results and "Your stock" the grid spans sets, so each tile
  // names its set.
  showSet?: boolean;
  onOpen: (card: CatalogCard) => void;
}) {
  const selling = Boolean(stock && stock.quantity > 0);
  const soldOut = Boolean(stock && stock.variants > 0 && stock.quantity === 0);
  const number = card.displayNumber || card.number;
  // What this card sells for in a Singles Shop (Near Mint, its default
  // finish) — the standardized price, not the raw market price.
  const market = marketPriceCents(card, isFoilOnly(card));
  const shopPrice = market > 0 ? singlesPriceCents(market, "Near Mint") : 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="group relative flex flex-col gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2"
    >
      <div
        className={`relative aspect-[5/7] w-full overflow-hidden rounded-lg bg-brand-surface transition-all duration-200 ${
          selling
            ? "shadow-md ring-2 ring-brand-gold group-hover:-translate-y-0.5 group-hover:shadow-lg"
            : "ring-1 ring-gray-200"
        }`}
      >
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.imageUrl}
            alt={card.name}
            loading="lazy"
            className={`h-full w-full object-cover transition duration-200 ${
              selling ? "" : "opacity-35 grayscale group-hover:opacity-75 group-focus-visible:opacity-75"
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-semibold text-gray-400">
            {card.name}
          </div>
        )}

        {selling && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-brand-gold px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow">
            ×{stock!.quantity > 999 ? "999+" : stock!.quantity}
          </span>
        )}
        {soldOut && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-gray-800/80 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            Sold out
          </span>
        )}
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold leading-none text-white/90">
          #{number}
        </span>

        {!selling && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="flex items-center gap-1 rounded-full bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              <Plus size={13} /> {soldOut ? "Restock" : "Add"}
            </span>
          </span>
        )}
      </div>

      <div className="min-w-0 px-0.5">
        <p className={`truncate text-xs font-semibold ${selling ? "text-gray-900" : "text-gray-500"}`}>{card.name}</p>
        <p className="truncate text-[11px] text-gray-400">
          {selling && stock?.fromCents !== undefined ? (
            <span className="font-semibold text-brand-gold">from {formatPrice(stock.fromCents)}</span>
          ) : shopPrice > 0 ? (
            <>Sells for {formatPrice(shopPrice)}</>
          ) : (
            <>No market price</>
          )}
          {showSet && <> · {card.setCode || card.setName}</>}
        </p>
      </div>
    </button>
  );
}
