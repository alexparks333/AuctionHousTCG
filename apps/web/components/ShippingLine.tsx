import { Mail, Truck, Feather } from "lucide-react";
import { type Listing, type ShippingPreset, shippingBadge } from "@/lib/types";

// The physical container a listing ships in — envelope-based presets share
// Mail; every package-mechanism preset (free bubble mailer, free box, paid
// Ground Advantage) shares Truck, matching how they all display as the
// same "Tracked Package" text (lib/types.ts's SHIPPING_METHOD_LABELS_COMPACT
// merge) — the icon shouldn't distinguish them either. Kept here rather
// than in lib/types.ts since that module is otherwise plain data/string
// helpers, no React/lucide imports.
const SHIPPING_PRESET_ICONS: Record<ShippingPreset, typeof Mail> = {
  free_envelope: Mail,
  tracked_envelope: Mail,
  free_bubble_mailer: Truck,
  free_box: Truck,
  shippo_ground_advantage: Truck,
};

// "+$1.56 · [envelope icon] Tracked Envelope" — the cost from
// shippingBadge, a container icon keyed off shippingPreset, then the
// method name, so a buyer sees what it physically ships in without
// clicking into the listing. Shared by ListingCard's grid, ListingRow's
// search-results row, and the listing detail page (AuctionPriceBox / the
// fixed-price page) so all three read identically — cost, then icon, then
// method — instead of independent (and inevitably drifting)
// implementations of the same fact in different orders.
export default function ShippingLine({
  listing,
  signatureRequired = false,
  size = "sm",
  className = "",
}: {
  listing: Listing;
  // Cards/rows show this as the Quill icon alone (real estate is tighter,
  // a hover tooltip is enough); the detail page instead renders its own
  // separate, larger "Signature required at delivery" line right below
  // this one and passes false here, so leave this off when a caller
  // already has its own signature notice elsewhere.
  signatureRequired?: boolean;
  // "sm" (default) is the compact card/row size; "lg" is the detail
  // page's larger price-box scale.
  size?: "sm" | "lg";
  className?: string;
}) {
  const { costLabel, methodLabel } = shippingBadge(listing);
  const Icon = SHIPPING_PRESET_ICONS[listing.shippingPreset];
  const iconSize = size === "lg" ? 16 : 12;
  return (
    <p
      className={`flex items-center gap-1 text-gray-500 ${size === "lg" ? "text-sm" : "text-xs"} ${className}`}
    >
      {costLabel && (
        <span className={`text-gray-600 ${size === "lg" ? "font-semibold" : "font-medium"}`}>
          {costLabel}
        </span>
      )}
      {costLabel && <span aria-hidden="true">·</span>}
      <Icon size={iconSize} className="shrink-0" />
      <span className="truncate">{methodLabel}</span>
      {signatureRequired && (
        <span title="Signature Needed" className="ml-1 shrink-0">
          <Feather size={iconSize} className="text-brand-gold" aria-label="Signature Needed" />
        </span>
      )}
    </p>
  );
}
