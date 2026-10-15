"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import MockCheckout from "@/components/MockCheckout";
import AddSinglesBar from "@/components/checkout/AddSinglesBar";
import { toRequests, type AddonSelection } from "@/components/checkout/addonSelection";
import { isStripeConfigured } from "@/lib/stripe";
import { onAddonsUnavailable } from "@/lib/checkoutEvents";
import type { Listing, ShippingPreset, ShopSingle } from "@/lib/types";

// The checkout page's two columns, with the "Add Singles To Your Order"
// selection lifted here so the compact bar (right, just above the payment
// card — it opens the full picker in a dialog) and the payment card
// (MockCheckout) share it: every change re-prices the order. The listing details themselves are server-rendered
// and passed in as `children`.
//
// The selection is kept in sessionStorage per listing so it survives the
// bank-linking redirect round trip (AddBankForm's returnPath) — a
// convenience only, wrapped in try/catch since storage can be unavailable.
export default function CheckoutBundle({
  listingId,
  priceCents,
  shippingPreset,
  shippingMethod,
  shippingCostLabel,
  sellerName,
  singles,
  bundleListings,
  children,
}: {
  listingId: string;
  priceCents: number;
  shippingPreset: ShippingPreset;
  shippingMethod: string;
  shippingCostLabel: string;
  sellerName: string;
  singles: ShopSingle[];
  bundleListings: Listing[];
  children: ReactNode;
}) {
  const storageKey = `checkout-addons:${listingId}`;
  const [selection, setSelection] = useState<AddonSelection>({});

  // Restored after mount, not in useState's initializer: the server render
  // has no sessionStorage, so reading it during render would make the
  // first client render disagree with the server HTML (hydration mismatch).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from browser storage after hydration (see above)
      if (saved) setSelection(JSON.parse(saved) as AddonSelection);
    } catch {
      // Storage unavailable or corrupt — start empty.
    }
  }, [storageKey]);

  function saveSelection(next: AddonSelection) {
    setSelection(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Best-effort only.
    }
  }

  function updateSelection(next: AddonSelection) {
    // Changing the order replaces the raw selection with one built from the
    // trimmed view, which would make trimmedNotice vanish — keep the
    // message up until the buyer dismisses it.
    if (trimmedNotice && !soldOutNotice) setSoldOutNotice(trimmedNotice);
    saveSelection(next);
  }

  // --- Keeping the seller's stock in sync with other buyers ---
  //
  // `singles`/`bundleListings` are server-rendered props; router.refresh()
  // re-fetches them without losing any client state here. That happens
  // when the server reports a sold-out add-on (the payment card emits
  // onAddonsUnavailable with the server's "Sorry, someone bought these
  // singles before you: ..." message), whenever the picker is opened, and
  // every 30s while the tab is visible — so the quantities a buyer sees
  // track other people's purchases. The server's compare-and-swap at
  // payment time (claimAddons) is still the real guard; this just makes
  // hitting it rare and clearly explained.
  const router = useRouter();
  const [soldOutNotice, setSoldOutNotice] = useState("");
  const [addonsVersion, setAddonsVersion] = useState(0);
  const resync = useCallback(() => router.refresh(), [router]);

  useEffect(
    () =>
      onAddonsUnavailable((message) => {
        setSoldOutNotice(message);
        setAddonsVersion((v) => v + 1);
        resync();
      }),
    [resync],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") resync();
    }, 30_000);
    return () => clearInterval(timer);
  }, [resync]);

  // Add-ons only resolve through the real Stripe checkout path — the
  // no-Stripe mock path never creates an order at all, so offering add-ons
  // there would just silently drop them.
  const offerAddons = isStripeConfigured() && singles.length + bundleListings.length > 0;

  // The selection trimmed to what the seller has right now: lines for items
  // no longer offered are dropped, and a single's quantity is capped at the
  // copies left (another buyer took some). Everything downstream — the
  // picker, the cart, the payment — uses this, never the raw selection.
  const effectiveSelection = useMemo(() => {
    const next: AddonSelection = {};
    if (!offerAddons) return next;
    for (const [key, line] of Object.entries(selection)) {
      if (line.kind === "single") {
        const s = singles.find((x) => x.id === line.id);
        const qty = Math.min(line.quantity, s?.quantity ?? 0);
        if (qty > 0) next[key] = { ...line, quantity: qty };
      } else if (bundleListings.some((l) => l.id === line.id)) {
        next[key] = line;
      }
    }
    return next;
  }, [selection, singles, bundleListings, offerAddons]);
  const addons = useMemo(() => Object.values(effectiveSelection), [effectiveSelection]);
  const addonRequests = useMemo(() => toRequests(addons), [addons]);

  // Lines the re-sync just cut back (another buyer's order took them while
  // this buyer was browsing) — named the same way the server names them.
  const trimmedItems: string[] = [];
  if (offerAddons) {
    for (const [key, line] of Object.entries(selection)) {
      const kept = effectiveSelection[key]?.quantity ?? 0;
      if (kept >= line.quantity) continue;
      const name = line.label ?? (line.kind === "single" ? "A single you added" : "A listing you added");
      trimmedItems.push(
        line.kind === "listing" ? `${name} — sold` : `${name} — ${kept === 0 ? "sold out" : `only ${kept} left`}`,
      );
    }
  }
  const trimmedNotice =
    trimmedItems.length > 0 ? `Sorry, someone bought these singles before you: ${trimmedItems.join(", ")}` : "";
  const notice = soldOutNotice || trimmedNotice;

  const previewCents = addons.reduce((sum, line) => {
    if (line.kind === "single") {
      const s = singles.find((x) => x.id === line.id);
      return sum + (s ? s.priceCents * line.quantity : 0);
    }
    return sum + (bundleListings.find((x) => x.id === line.id)?.priceCents ?? 0);
  }, 0);
  const addedCards = addons.reduce((n, line) => n + line.quantity, 0);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,48rem)_1fr]">
      <div className="flex flex-col gap-6">
        {children}
      </div>

      <aside>
        <div className="sticky top-6">
          {offerAddons && (
            <AddSinglesBar
              sellerName={sellerName}
              singles={singles}
              listings={bundleListings}
              selection={effectiveSelection}
              onChange={updateSelection}
              onOpen={resync}
              addedCards={addedCards}
              addedCents={previewCents}
            />
          )}
          {notice && (
            <div
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-xl border border-brand-urgent/30 bg-brand-urgent/5 px-4 py-3 text-sm text-brand-urgent"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p className="flex-1">
                <span className="font-semibold">{notice}</span>
                <span className="mt-1 block text-xs text-gray-600">
                  We&apos;ve updated your order to what&apos;s still in stock. You haven&apos;t been charged — check the
                  total and pay again.
                </span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setSoldOutNotice("");
                  // Accept the trimmed order as the new selection.
                  saveSelection(effectiveSelection);
                }}
                className="rounded-full p-0.5 text-gray-400 hover:text-gray-700"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <MockCheckout
            listingId={listingId}
            priceCents={priceCents}
            shippingPreset={shippingPreset}
            shippingMethod={shippingMethod}
            shippingCostLabel={shippingCostLabel}
            addons={addonRequests}
            addonsPreviewCents={previewCents}
            addedCards={addedCards}
            addonsVersion={addonsVersion}
          />
        </div>
      </aside>
    </div>
  );
}
