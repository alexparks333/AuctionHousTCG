"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Mail, Package } from "lucide-react";
import { CartButton } from "@/components/checkout/AddSinglesBar";
import type { AddonSelection } from "@/components/checkout/addonSelection";
import { ApiError, startSinglesOrder } from "@/lib/api";
import {
  MIN_SINGLES_ORDER_CENTS,
  SINGLES_ENVELOPE_MAX_CARDS,
  formatPrice,
  type ShopSingle,
} from "@/lib/types";

// Where a seller's profile cart is kept (SinglesShopShowcase).
export function cartStorageKey(username: string): string {
  return `singles-cart:${username.toLowerCase()}`;
}

// The footer of a seller's Singles Shop dialog on their profile: the cart,
// progress toward the singles-only minimum, and "Check out". Checking out
// opens (or reuses) the buyer's singles order for this seller
// (POST /users/{username}/singles-order), hands the cart to the checkout
// page through the same sessionStorage key CheckoutBundle restores from,
// and goes to /checkout/{id} — the same checkout every purchase uses.
export default function SinglesCartFooter({
  username,
  singles,
  selection,
  onChange,
  isLoggedIn,
}: {
  username: string;
  singles: ShopSingle[];
  selection: AddonSelection;
  onChange: (next: AddonSelection) => void;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  let cards = 0;
  let cents = 0;
  for (const line of Object.values(selection)) {
    const s = singles.find((x) => x.id === line.id);
    if (!s) continue;
    cards += line.quantity;
    cents += s.priceCents * line.quantity;
  }
  const short = Math.max(0, MIN_SINGLES_ORDER_CENTS - cents);
  const progress = Math.min(100, (cents / MIN_SINGLES_ORDER_CENTS) * 100);
  const asPackage = cards > SINGLES_ENVELOPE_MAX_CARDS;

  async function checkout() {
    setStarting(true);
    setError("");
    try {
      const { listingId } = await startSinglesOrder(username);
      try {
        sessionStorage.setItem(`checkout-addons:${listingId}`, JSON.stringify(selection));
        // The cart now lives on the checkout page (and is edited there).
        // Only the saved copy is dropped — clearing the visible cart would
        // flash it empty while the checkout page loads.
        sessionStorage.removeItem(cartStorageKey(username));
      } catch {
        // Storage unavailable — the checkout page still lets them add
        // singles there.
      }
      router.push(`/checkout/${listingId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        setError(`${username} hasn't finished setting up payouts yet, so their singles can't be bought right now.`);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't start checkout.");
      }
      setStarting(false);
    }
  }

  return (
    <div className="border-t border-brand-border px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {cards === 0 ? (
            <p className="text-sm text-gray-600">
              Click a card to add it. Buy singles on their own from{" "}
              <span className="font-semibold text-gray-900">{formatPrice(MIN_SINGLES_ORDER_CENTS)}</span>, or add them to
              any order from {username} with no minimum.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">
                  {cards} {cards === 1 ? "card" : "cards"}
                </span>{" "}
                · {formatPrice(cents)}
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-500">
                  {asPackage ? <Package size={13} /> : <Mail size={13} />}
                  {asPackage ? "Tracked package" : "Tracked envelope"}
                </span>
                <button
                  type="button"
                  onClick={() => onChange({})}
                  className="ml-3 text-xs font-medium text-gray-500 hover:text-brand-urgent"
                >
                  Clear
                </button>
              </p>
              {short > 0 ? (
                <div className="mt-1.5 flex max-w-sm items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-brand-gold transition-[width] duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs font-medium text-gray-600">
                    Add {formatPrice(short)} more to check out
                  </span>
                </div>
              ) : (
                <p className="mt-0.5 text-xs text-gray-500">
                  {asPackage
                    ? `Over ${SINGLES_ENVELOPE_MAX_CARDS} cards ships as a tracked package — shipping is quoted at checkout.`
                    : `Up to ${SINGLES_ENVELOPE_MAX_CARDS} cards ship in a tracked envelope.`}
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <CartButton
            singles={singles}
            listings={[]}
            selection={selection}
            onChange={onChange}
            addedCards={cards}
            addedCents={cents}
          />
          {isLoggedIn ? (
            <button
              type="button"
              onClick={checkout}
              disabled={short > 0 || cards === 0 || starting}
              className="flex items-center gap-1.5 rounded-full bg-brand-navy px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {starting ? <Loader2 size={15} className="animate-spin" /> : null}
              Check out
              {!starting && <ArrowRight size={15} />}
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-brand-navy px-6 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90"
            >
              Sign in to buy
            </Link>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-brand-urgent">{error}</p>}
    </div>
  );
}
