"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import BundleTag from "@/components/BundleTag";
import SingleCardIcon from "@/components/singles/SingleCardIcon";
import { getOrderAddonsClient, type OrderAddon } from "@/lib/api";
import { formatPrice } from "@/lib/types";

// The Bundle tag, plus a hover/focus popover to its right listing every
// card bundled onto the order. The list is fetched on first hover (and
// cached for the life of the component) from the order endpoint, which
// already returns add-ons — the Transactions list itself only carries a
// count, so rendering it stays as cheap as before.
export default function BundleTagPreview({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [addons, setAddons] = useState<OrderAddon[] | null>(null);
  const [error, setError] = useState(false);
  const requested = useRef(false);

  function show() {
    setOpen(true);
    if (requested.current) return;
    requested.current = true;
    getOrderAddonsClient(listingId)
      .then(setAddons)
      .catch(() => {
        setError(true);
        requested.current = false; // allow a retry on the next hover
      });
  }

  const cardCount = addons?.reduce((n, a) => n + a.quantity, 0) ?? 0;
  const totalCents =
    addons?.reduce((n, a) => n + a.quantity * a.unitPriceCents, 0) ?? 0;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="cursor-default rounded-full"
        aria-label="Show bundled cards"
        aria-expanded={open}
      >
        <BundleTag />
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute left-full top-1/2 z-40 ml-2 w-80 -translate-y-1/2 rounded-xl border border-brand-border bg-white p-3 text-left shadow-xl"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Bundled in this order
            {addons && addons.length > 0 && (
              <span className="normal-case tracking-normal text-gray-400">
                {" "}
                · {cardCount} {cardCount === 1 ? "card" : "cards"} ·{" "}
                {formatPrice(totalCents)}
              </span>
            )}
          </p>

          {error ? (
            <p className="mt-2 text-sm text-brand-urgent">
              Couldn&apos;t load the bundled cards.
            </p>
          ) : addons === null ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-500">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </p>
          ) : addons.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No bundled cards.</p>
          ) : (
            <ul className="mt-2 flex max-h-80 flex-col divide-y divide-brand-border overflow-y-auto">
              {addons.map((a, i) => (
                <li
                  key={`${a.kind}-${a.shopSingleId ?? a.listingId}-${i}`}
                  className="flex items-center gap-2.5 py-2"
                >
                  <div className="w-9 shrink-0">
                    {a.kind === "single" ? (
                      <SingleCardIcon
                        single={{ cardName: a.title, imageUrl: a.imageUrl }}
                      />
                    ) : a.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.imageUrl}
                        alt=""
                        className="aspect-[63/88] w-full rounded object-cover"
                      />
                    ) : (
                      <div className="aspect-[63/88] w-full rounded bg-gradient-to-br from-brand-navy/20 to-brand-gold/20" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {a.title}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {[
                        a.setName,
                        a.cardNumber && `#${a.cardNumber}`,
                        a.condition,
                        a.kind === "single" && (a.isFoil ? "Foil" : "Non-foil"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      ×{a.quantity}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {formatPrice(a.unitPriceCents)} ea
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
