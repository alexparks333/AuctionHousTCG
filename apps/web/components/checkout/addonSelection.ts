import type { CheckoutAddonRequest } from "@/lib/api";
import { CONDITION_SHORT, type Listing, type ShopSingle } from "@/lib/types";

// One line of the buyer's "Add Singles To Your Order" picks. `label` is for
// the buyer only ("Rengar (NM, Foil)") — it's how a line that sells out
// while they're checking out can still be named once the seller's stock
// list no longer includes it. It's never sent to the server: toRequests
// strips it, and the server prices everything itself (apps/api/internal/
// auction/addons.go).
export type AddonLine = CheckoutAddonRequest & { label?: string };
export type AddonSelection = Record<string, AddonLine>;

export function addonKey(kind: CheckoutAddonRequest["kind"], id: string): string {
  return `${kind}:${id}`;
}

// Same format as the server's singleLabel (AddonUnavailableError).
export function singleLabel(s: Pick<ShopSingle, "cardName" | "condition" | "isFoil">): string {
  return `${s.cardName} (${CONDITION_SHORT[s.condition] ?? s.condition}, ${s.isFoil ? "Foil" : "Non-foil"})`;
}

// Sets how many copies of one single are in the order, clamped to what the
// seller has; 0 removes the line.
export function withSingleQty(selection: AddonSelection, single: ShopSingle, qty: number): AddonSelection {
  const key = addonKey("single", single.id);
  const next = { ...selection };
  const clamped = Math.max(0, Math.min(qty, single.quantity));
  if (clamped === 0) delete next[key];
  else next[key] = { kind: "single", id: single.id, quantity: clamped, label: singleLabel(single) };
  return next;
}

export function withListingToggled(selection: AddonSelection, listing: Pick<Listing, "id" | "title">): AddonSelection {
  const key = addonKey("listing", listing.id);
  const next = { ...selection };
  if (next[key]) delete next[key];
  else next[key] = { kind: "listing", id: listing.id, quantity: 1, label: listing.title };
  return next;
}

// The lines as the checkout-intent request wants them — ids and quantities
// only.
export function toRequests(lines: AddonLine[]): CheckoutAddonRequest[] {
  return lines.map(({ kind, id, quantity }) => ({ kind, id, quantity }));
}
