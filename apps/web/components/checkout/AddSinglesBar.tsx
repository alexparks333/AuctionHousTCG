"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Minus, PackagePlus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import SinglesBrowser from "@/components/checkout/SinglesBrowser";
import {
  addonKey,
  withListingToggled,
  withSingleQty,
  type AddonSelection,
} from "@/components/checkout/addonSelection";
import { CONDITION_SHORT } from "@/lib/types";
import { formatPrice, type Listing, type ShopSingle } from "@/lib/types";

// "Add Singles To Your Order" as one compact row above the payment card —
// the checkout's focus stays on paying for the card the buyer came for.
// Clicking it opens the seller's shop (SinglesBrowser) in a dialog; the
// selection lives in CheckoutBundle, so the order total re-prices live
// behind it.
export default function AddSinglesBar({
  sellerName,
  singles,
  listings,
  selection,
  onChange,
  addedCards,
  addedCents,
  onOpen,
}: {
  // Called when the picker opens — CheckoutBundle re-syncs the seller's
  // stock so the quantities shown are current.
  onOpen?: () => void;
  sellerName: string;
  singles: ShopSingle[];
  listings: Listing[];
  selection: AddonSelection;
  onChange: (next: AddonSelection) => void;
  addedCards: number;
  addedCents: number;
}) {
  const [open, setOpen] = useState(false);
  const available = singles.length + listings.length;

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

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onOpen?.();
        }}
        className="group mb-3 flex w-full items-center gap-3 rounded-xl border border-brand-gold/50 bg-white px-4 py-3 text-left transition-colors hover:border-brand-gold hover:bg-amber-50/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gold/15 text-brand-gold">
          <PackagePlus size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">
            Add Singles To Your Order
          </span>
          <span className="block truncate text-xs text-gray-500">
            {addedCards > 0
              ? `${addedCards} added · ${formatPrice(addedCents)} · ships with your card`
              : `${available} available from ${sellerName} · ships with your card`}
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-brand-navy">
          {addedCards > 0 ? "Edit" : "Browse"}
          <ChevronRight
            size={15}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </button>

      {/* Portaled to <body>: the bar lives inside the sticky payment
          column, whose stacking context would otherwise let the listing
          gallery's badges paint over the dialog. */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Add Singles To Your Order"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-gray-950/50 backdrop-blur-[1px]"
            />
            <div className="relative flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-brand-border px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Add Singles To Your Order</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    From {sellerName}&apos;s shop. Everything ships together with your card.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1.5 text-gray-400 hover:bg-brand-surface hover:text-gray-700"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="relative min-h-0 flex-1">
                <SinglesBrowser
                  sellerName={sellerName}
                  singles={singles}
                  listings={listings}
                  selection={selection}
                  onChange={onChange}
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-brand-border px-5 py-3">
                <p className="text-sm text-gray-600">
                  {addedCards > 0 ? (
                    <>
                      <span className="font-semibold text-gray-900">
                        {addedCards} {addedCards === 1 ? "card" : "cards"} added
                      </span>{" "}
                      · {formatPrice(addedCents)}
                      <button
                        type="button"
                        onClick={() => onChange({})}
                        className="ml-3 text-xs font-medium text-gray-500 hover:text-brand-urgent"
                      >
                        Clear
                      </button>
                    </>
                  ) : (
                    "Nothing added yet"
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <CartButton
                    singles={singles}
                    listings={listings}
                    selection={selection}
                    onChange={onChange}
                    addedCards={addedCards}
                    addedCents={addedCents}
                  />
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-full bg-brand-navy px-6 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// The cart icon next to Done: a badge with how many cards are added, and a
// popover listing each one (quantity, price, remove) with the subtotal.
function CartButton({
  singles,
  listings,
  selection,
  onChange,
  addedCards,
  addedCents,
}: {
  singles: ShopSingle[];
  listings: Listing[];
  selection: AddonSelection;
  onChange: (next: AddonSelection) => void;
  addedCards: number;
  addedCents: number;
}) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking anywhere outside the popover.
  useEffect(() => {
    if (!show) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [show]);

  const singleLines = singles
    .map((s) => ({ single: s, qty: selection[addonKey("single", s.id)]?.quantity ?? 0 }))
    .filter((l) => l.qty > 0);
  const listingLines = listings.filter((l) => selection[addonKey("listing", l.id)]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={`Cart, ${addedCards} ${addedCards === 1 ? "card" : "cards"}`}
        aria-expanded={show}
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          show ? "border-brand-navy bg-brand-navy text-white" : "border-gray-300 text-gray-700 hover:border-brand-navy"
        }`}
      >
        <ShoppingCart size={17} />
        {addedCards > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-brand-gold px-1 py-0.5 text-center text-[10px] font-black leading-none text-white shadow">
            {addedCards > 99 ? "99+" : addedCards}
          </span>
        )}
      </button>

      {show && (
        <div className="absolute bottom-full right-0 mb-2 w-80 overflow-hidden rounded-xl border border-brand-border bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-brand-border px-4 py-2.5">
            <p className="text-sm font-bold text-gray-900">
              Cart · {addedCards} {addedCards === 1 ? "card" : "cards"}
            </p>
            {addedCards > 0 && (
              <button
                type="button"
                onClick={() => onChange({})}
                className="text-xs font-medium text-gray-500 hover:text-brand-urgent"
              >
                Clear all
              </button>
            )}
          </div>
          {addedCards === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">Your cart is empty. Click a card to add it.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-brand-border overflow-y-auto">
              {singleLines.map(({ single: s, qty }) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt="" className="aspect-[5/7] w-9 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="aspect-[5/7] w-9 shrink-0 rounded bg-brand-surface" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{s.cardName}</p>
                    <p className="truncate text-[11px] text-gray-500">
                      {CONDITION_SHORT[s.condition] ?? s.condition}
 · {s.isFoil ? "Foil" : "Non-foil"} · {formatPrice(s.priceCents)} each
                    </p>
                  </div>
                  <div className="flex items-center rounded-full border border-gray-300">
                    <button
                      type="button"
                      onClick={() => onChange(withSingleQty(selection, s, qty - 1))}
                      className="rounded-full p-1 text-gray-600 hover:bg-brand-surface"
                      aria-label={`Remove one ${s.cardName}`}
                    >
                      {qty === 1 ? <Trash2 size={12} /> : <Minus size={12} />}
                    </button>
                    <span className="w-5 text-center text-xs font-bold">{qty}</span>
                    <button
                      type="button"
                      onClick={() => onChange(withSingleQty(selection, s, qty + 1))}
                      disabled={qty >= s.quantity}
                      className="rounded-full p-1 text-gray-600 hover:bg-brand-surface disabled:opacity-30"
                      aria-label={`Add another ${s.cardName}`}
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </li>
              ))}
              {listingLines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{l.title}</p>
                    <p className="text-[11px] text-gray-500">Buy It Now · {formatPrice(l.priceCents ?? 0)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(withListingToggled(selection, l))}
                    className="rounded-full p-1.5 text-gray-400 hover:bg-red-50 hover:text-brand-urgent"
                    aria-label={`Remove ${l.title}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {addedCards > 0 && (
            <div className="flex items-center justify-between border-t border-brand-border bg-brand-surface/60 px-4 py-2.5 text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span className="font-bold text-gray-900">{formatPrice(addedCents)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
