"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import AddSinglesBar from "@/components/checkout/AddSinglesBar";
import { addonKey, withSingleQty, type AddonSelection } from "@/components/checkout/addonSelection";
import { CONDITION_SHORT, formatPrice, type ShopSingle } from "@/lib/types";

// A singles-only order's cart on the checkout page (CheckoutBundle's left
// column when singlesOnly): every single in the order with its quantity
// stepper, plus the seller's shop (AddSinglesBar's dialog) to add more.
export default function SinglesOrderCart({
  sellerName,
  singles,
  selection,
  onChange,
  onOpen,
  addedCards,
  addedCents,
}: {
  sellerName: string;
  singles: ShopSingle[];
  selection: AddonSelection;
  onChange: (next: AddonSelection) => void;
  onOpen: () => void;
  addedCards: number;
  addedCents: number;
}) {
  const lines = singles
    .map((s) => ({ single: s, qty: selection[addonKey("single", s.id)]?.quantity ?? 0 }))
    .filter((l) => l.qty > 0);

  return (
    <div className="rounded-xl border border-brand-border bg-white">
      <div className="flex items-center justify-between border-b border-brand-border px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Your singles{addedCards > 0 && ` · ${addedCards} ${addedCards === 1 ? "card" : "cards"}`}
        </h2>
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

      {lines.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          Your cart is empty — add singles from {sellerName}&apos;s shop below.
        </p>
      ) : (
        <ul className="divide-y divide-brand-border">
          {lines.map(({ single: s, qty }) => (
            <li key={s.id} className="flex items-center gap-4 px-5 py-3">
              {s.imageUrl ? (
                // Catalog images come from TCG Haven's CDN, not Supabase
                // Storage, so they aren't served through next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} alt="" className="aspect-[5/7] w-12 shrink-0 rounded-md object-cover shadow-sm" />
              ) : (
                <span className="aspect-[5/7] w-12 shrink-0 rounded-md bg-brand-surface" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{s.cardName}</p>
                <p className="truncate text-xs text-gray-500">
                  {s.setName} · {CONDITION_SHORT[s.condition] ?? s.condition} · {s.isFoil ? "Foil" : "Non-foil"} ·{" "}
                  {formatPrice(s.priceCents)} each
                </p>
              </div>
              <div className="flex items-center rounded-full border border-gray-300">
                <button
                  type="button"
                  onClick={() => onChange(withSingleQty(selection, s, qty - 1))}
                  className="rounded-full p-1.5 text-gray-600 hover:bg-brand-surface"
                  aria-label={`Remove one ${s.cardName}`}
                >
                  {qty === 1 ? <Trash2 size={13} /> : <Minus size={13} />}
                </button>
                <span className="w-6 text-center text-sm font-bold">{qty}</span>
                <button
                  type="button"
                  onClick={() => onChange(withSingleQty(selection, s, qty + 1))}
                  disabled={qty >= s.quantity}
                  className="rounded-full p-1.5 text-gray-600 hover:bg-brand-surface disabled:opacity-30"
                  aria-label={`Add another ${s.cardName}`}
                >
                  <Plus size={13} />
                </button>
              </div>
              <span className="w-16 text-right text-sm font-semibold text-gray-900">
                {formatPrice(s.priceCents * qty)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-brand-border px-5 pt-3">
        <AddSinglesBar
          variant="singles"
          sellerName={sellerName}
          singles={singles}
          listings={[]}
          selection={selection}
          onChange={onChange}
          onOpen={onOpen}
          addedCards={addedCards}
          addedCents={addedCents}
        />
      </div>
    </div>
  );
}
