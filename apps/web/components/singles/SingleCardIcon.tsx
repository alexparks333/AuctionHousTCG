import type { ShopSingle } from "@/lib/types";

// The standardized "icon" a Singles Shop single renders as everywhere — the
// catalog's own card image (never a seller photo; that's the whole point of
// the Singles Shop vs. a listing). Nothing is drawn over the card (explicit
// product decision): condition and finish are written out as text next to
// it wherever it's used.
export default function SingleCardIcon({
  single,
  className = "",
}: {
  single: Pick<ShopSingle, "cardName" | "imageUrl">;
  className?: string;
}) {
  return (
    <div className={`relative aspect-[63/88] overflow-hidden rounded-lg bg-brand-surface ${className}`}>
      {single.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={single.imageUrl} alt={single.cardName} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-medium text-gray-500">
          {single.cardName}
        </div>
      )}
    </div>
  );
}
