import Link from "next/link";
import { PackagePlus } from "lucide-react";
import SingleCardIcon from "@/components/singles/SingleCardIcon";
import type { OrderAddon } from "@/lib/api";
import { formatPrice } from "@/lib/types";

// Everything bundled onto an order at checkout ("Add Singles To Your
// Order") — for the seller, the packing list for the same shipment as the
// primary card; for the buyer, what they added. Voided lines (the order was
// cancelled and the stock released) are shown struck through.
export default function OrderAddonsList({
  addons,
  viewerIsSeller,
}: {
  addons: OrderAddon[] | undefined;
  viewerIsSeller: boolean;
}) {
  if (!addons || addons.length === 0) return null;

  const cardCount = addons.reduce((n, a) => n + a.quantity, 0);
  const totalCents = addons.reduce(
    (n, a) => n + a.quantity * a.unitPriceCents,
    0,
  );

  return (
    <section className="rounded-xl border border-brand-border bg-white p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <PackagePlus size={16} />
        Singles Added To This Order
      </h2>
      <p className="mt-0.5 text-xs text-gray-500">
        {cardCount} {cardCount === 1 ? "card" : "cards"} ·{" "}
        {formatPrice(totalCents)},{" "}
        {viewerIsSeller
          ? "pack these in the same shipment as the main card."
          : "shipping together with the main card."}
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-brand-border">
        {addons.map((a, i) => (
          <li
            key={`${a.kind}-${a.shopSingleId ?? a.listingId}-${i}`}
            className={`flex items-center gap-3 py-2.5 ${a.voided ? "opacity-50" : ""}`}
          >
            <div className="w-10 shrink-0">
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
                <div className="aspect-[63/88] w-full rounded bg-brand-surface" />
              )}
            </div>
            <div className={`min-w-0 flex-1 ${a.voided ? "line-through" : ""}`}>
              {a.kind === "listing" && a.listingId ? (
                <Link
                  href={`/listing/${a.listingId}`}
                  className="block truncate text-sm font-medium text-gray-900 hover:underline"
                >
                  {a.title}
                </Link>
              ) : (
                <p className="truncate text-sm font-medium text-gray-900">
                  {a.title}
                </p>
              )}
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
            <div className="shrink-0 text-right text-sm">
              <p className="font-semibold text-gray-900">×{a.quantity}</p>
              <p className="text-xs text-gray-500">
                {formatPrice(a.unitPriceCents)} ea
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
