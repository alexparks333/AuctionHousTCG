"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, AlertTriangle, ShieldCheck, Feather } from "lucide-react";
import BidBox from "./BidBox";
import BuyNowButton from "./BuyNowButton";
import MakeOfferButton from "./MakeOfferButton";
import SoldBanner from "./SoldBanner";
import OwnerListingBanner from "./OwnerListingBanner";
import PaymentCountdown from "./PaymentCountdown";
import ShippingLine from "./ShippingLine";
import { getListing, type BidResult } from "@/lib/api";
import {
  formatPrice,
  formatMsLeft,
  paymentDueAt,
  effectiveShipping,
  DEFAULT_PACKAGE_ESTIMATE_CENTS,
  type Listing,
  type MyBid,
} from "@/lib/types";
import { useMsLeft } from "@/lib/useMsLeft";
import { usePokeCelebrations } from "./CelebrationWatcher";

// How often to poll for the live price/bid-count/leader — this is what
// lets a DIFFERENT bidder's action (or the same auction open in another
// tab) show up without a manual refresh. Your own bid updates instantly
// from the POST response (handleBidPlaced below), no polling involved —
// this is purely to keep spectators/the other side of a bidding war
// in sync too.
const PRICE_POLL_MS = 2000;

// The listing detail page's price/countdown used to be computed once,
// server-side, at request time — a card on the homepage would keep
// ticking down live (ListingCard/useMsLeft) while the very same auction's
// detail page sat frozen at whatever time was left when it loaded. This
// pulls the countdown onto the same live client-side hook everything else
// uses, so clicking into an auction never "freezes" the number you were
// just watching count down, and the bid form actually disappears the
// instant the clock runs out rather than staying usable until a refresh.
export default function AuctionPriceBox({
  listing,
  isOwner,
  isLoggedIn,
  currentUserId,
  myBid,
}: {
  listing: Listing;
  isOwner: boolean;
  isLoggedIn: boolean;
  currentUserId?: string;
  myBid?: MyBid;
}) {
  const router = useRouter();
  const msLeft = useMsLeft(listing.endsAt);
  const hasEnded = msLeft !== null && msLeft <= 0;

  const hasRefreshed = useRef(false);
  const poke = usePokeCelebrations();

  // Live auction numbers, seeded from the server props but from then on
  // updated either instantly (your own bid's response, no round trip) or
  // via the short poll (someone else's bid). Resynced during render
  // (React's "adjust state when a prop changes" pattern) whenever the
  // server gives fresh props — e.g. after the end-of-auction refresh below.
  const [prevListing, setPrevListing] = useState(listing);
  const [live, setLive] = useState({
    currentPriceCents: listing.currentPriceCents ?? listing.startingBidCents ?? 0,
    bidCount: listing.bidCount ?? 0,
    highBidderId: listing.highBidderId,
    outcome: listing.outcome,
    paidAt: listing.paidAt,
    // Buy It Now (and, since MakeOfferButton has nothing to measure an
    // offer against once it's gone, the offer button alongside it) has to
    // live here too, not just be read straight off the `listing` prop —
    // internal/auction.PlaceBid clears buyItNowPriceCents server-side the
    // instant a bid lands, but this component only re-renders from a fresh
    // `listing` prop on a full page load/refresh. Without tracking it here,
    // handleBidPlaced's own bid response has nowhere to write that change,
    // so Buy It Now kept showing until the page was manually reloaded —
    // the exact bug this was built to fix.
    buyItNowPriceCents: listing.buyItNowPriceCents,
  });
  if (listing !== prevListing) {
    setPrevListing(listing);
    setLive({
      currentPriceCents: listing.currentPriceCents ?? listing.startingBidCents ?? 0,
      bidCount: listing.bidCount ?? 0,
      highBidderId: listing.highBidderId,
      outcome: listing.outcome,
      paidAt: listing.paidAt,
      buyItNowPriceCents: listing.buyItNowPriceCents,
    });
  }

  // A Buy It Now purchase closes the auction outright (internal/auction/
  // buynow.go) regardless of how much time is left on the clock — hasEnded
  // alone (purely time-based) would miss that, so anything with a set
  // outcome — whether from the initial server props or picked up by the
  // poll below when someone ELSE buys it while this page is open — counts
  // as closed too.
  const auctionClosed = hasEnded || Boolean(live.outcome);

  // Only relevant for the transition, not the initial render — a page
  // loaded after the auction is already closed (whether by time or by a
  // Buy It Now purchase) has no "final bid" to refresh for.
  const [alreadyClosedAtMount] = useState(auctionClosed);

  // The caller's own current private max — only ever changes via their
  // own successful bid, never via the poll (the poll's GET /listings/{id}
  // has no way to know anyone's private max, only the public high bid).
  const [myMaxBidCents, setMyMaxBidCents] = useState(myBid?.myMaxBidCents);

  function handleBidPlaced(result: BidResult, maxBidCents: number) {
    setLive({
      currentPriceCents: result.currentPriceCents,
      bidCount: result.bidCount,
      highBidderId: result.highBidderId,
      outcome: undefined,
      paidAt: undefined,
      // Every successful bid clears Buy It Now server-side — see the doc
      // comment on `live`'s own declaration above.
      buyItNowPriceCents: undefined,
    });
    setMyMaxBidCents(maxBidCents);
  }

  useEffect(() => {
    if (auctionClosed) return;
    const id = setInterval(async () => {
      try {
        const fresh = await getListing(listing.id);
        if (!fresh) return;
        // bidCount only ever increases — guard against a slow poll
        // response landing after a newer bid (yours or someone else's)
        // and flickering the display back to stale numbers.
        setLive((current) =>
          (fresh.bidCount ?? 0) >= current.bidCount
            ? {
                currentPriceCents: fresh.currentPriceCents ?? current.currentPriceCents,
                bidCount: fresh.bidCount ?? current.bidCount,
                highBidderId: fresh.highBidderId,
                outcome: fresh.outcome ?? current.outcome,
                paidAt: fresh.paidAt ?? current.paidAt,
                buyItNowPriceCents: fresh.buyItNowPriceCents,
              }
            : current
        );
      } catch {
        // Best-effort — a missed poll just gets retried next interval.
      }
    }, PRICE_POLL_MS);
    return () => clearInterval(id);
  }, [listing.id, auctionClosed]);

  useEffect(() => {
    if (alreadyClosedAtMount || !auctionClosed || hasRefreshed.current) return;
    hasRefreshed.current = true;
    // Pulls the authoritative final price/bid-count/outcome (cmd/worker's
    // close pass may still be a few seconds from running) rather than
    // leaving this tab showing whatever it had cached the instant before
    // the clock hit zero.
    router.refresh();
    // Whoever's watching this exact auction end is the one person most
    // likely to have just won it — check right now instead of waiting
    // for CelebrationWatcher's next scheduled poll.
    poke();
  }, [auctionClosed, alreadyClosedAtMount, router, poke]);

  const youAreWinning = Boolean(currentUserId) && live.highBidderId === currentUserId;
  const hasBid = myMaxBidCents !== undefined;

  // What this listing will ACTUALLY ship as, given the live current bid —
  // not just what the seller originally chose. Mirrors
  // apps/api/internal/shipping.UpgradePreset (display-only; the backend
  // always recomputes the real thing fresh at checkout/close time), so a
  // low-starting-bid auction that climbs past $100/$250 shows the upgraded
  // tracked package/signature requirement live, instead of only surfacing
  // once someone's already won it. When the effective preset differs from
  // the seller's original one, this listing was never quoted for it (that
  // quote only ever happens for whatever preset was chosen at Create/
  // Update time) — falls back to DEFAULT_PACKAGE_ESTIMATE_CENTS in that
  // case, the exact same fallback shipping.ChargedCents itself uses
  // server-side for an upgraded order with no real estimate, so this reads
  // as a normal Ground Advantage estimate ("~$6.00 shipping"), not the
  // ambiguous "Shipping cost at checkout" a missing estimate used to show.
  const effective = effectiveShipping(listing.shippingPreset, live.currentPriceCents, listing.requestSignature);
  const effectiveListing =
    effective.preset === listing.shippingPreset
      ? listing
      : {
          ...listing,
          shippingPreset: effective.preset,
          estimatedShippingCents:
            effective.preset === "shippo_ground_advantage" ? DEFAULT_PACKAGE_ESTIMATE_CENTS : undefined,
        };

  // The "Upgraded" badge is for a REAL upgrade bidding caused — compared
  // against what this listing would have resolved to at its own starting
  // bid, not against whatever this particular page load happened to catch
  // mid-session. That's what tells apart the two cases that look identical
  // from "does effective differ from stored right now":
  //  - A $0.01-starting auction real bids pushed to $100+: at its
  //    starting bid, effectiveShipping still resolves to the seller's
  //    original (envelope) preset — so `original` and `current` genuinely
  //    differ, and this IS a bidding-driven upgrade, however long ago it
  //    crossed the line or whether this viewer just loaded the page fresh.
  //  - A listing whose STARTING bid was already past the bar (a stale
  //    seller-chosen preset that predates this feature, e.g. a $120
  //    starting bid still set to Tracked Envelope): `original` already
  //    resolves the same way `current` does, since both are evaluated
  //    against a price that was always over the line — no bidding did
  //    anything here, so no badge.
  // Keying the block on this (not the poll tick) is what makes the
  // pop-in replay exactly once, the instant a live bid actually flips it
  // from false to true, and never again on subsequent polls once it's
  // already true.
  const original = effectiveShipping(listing.shippingPreset, listing.startingBidCents ?? 0, listing.requestSignature);
  const isBidDrivenUpgrade =
    effective.preset !== original.preset || effective.signatureRequired !== original.signatureRequired;

  // Won via regular bidding (not Buy It Now, which already collects
  // payment atomically at purchase time) and not yet paid — matches
  // Bids/Offers' own "Awaiting Payment" treatment (lib/types.ts's
  // isAwaitingPayment), just surfaced here too so winning an auction and
  // landing straight back on its own listing page (not via Bids/Offers)
  // still makes it obvious there's a payment step left.
  const youWonAwaitingPayment = youAreWinning && live.outcome === "sold" && !live.paidAt;

  return (
    <>
      <p className="text-xs text-gray-500">
        {auctionClosed ? "Auction ended — final price" : "Current bid"}
      </p>
      {/* Same red-when-ended treatment ListingCard already uses for its own
          price figure (hasEnded ? text-brand-urgent : text-gray-900) — this
          detail page's price number was the one place that convention
          hadn't been applied, so a sold/ended auction here still read as a
          plain, still-live "current bid" at a glance. */}
      <p className={`text-3xl font-bold ${auctionClosed ? "text-brand-urgent" : "text-gray-900"}`}>
        {formatPrice(live.currentPriceCents)}
      </p>
      <p className="mt-1 flex items-center justify-between text-sm">
        <span className="text-gray-500">{live.bidCount} bids</span>
        <span
          className="font-semibold text-brand-urgent"
          // See the matching comment in ListingCard.tsx — server/client
          // Date.now() skew on first paint, not a real bug; useMsLeft's
          // own interval corrects it within a second. Gated on
          // !auctionClosed — msLeft is purely clock-math off endsAt, so a
          // listing bought early via Buy It Now (auctionClosed via
          // live.outcome, well before its scheduled endsAt) would
          // otherwise keep showing a live countdown on an item that's
          // already sold — the actual bug that prompted this guard.
          suppressHydrationWarning
        >
          {!auctionClosed && msLeft !== null ? formatMsLeft(msLeft) : ""}
        </span>
      </p>

      {/* Shipping/payment-protected lives here — always right after the
          price header, regardless of which branch below renders (closed,
          owner, bidding, signed-out) — rather than as a page-level sibling
          after this whole component, which is what the fixed-price listing
          path still does (app/listing/[id]/page.tsx). Moved in specifically
          so Buy It Now (further down, inside the isLoggedIn branch) can sit
          below it: product decision that Buy It Now shouldn't be the first
          thing a bidder sees above the bidding box and the real shipping
          cost, on an item they might also just want to bid on. */}
      {/* Keyed on isBidDrivenUpgrade (not the poll tick) so this only
          remounts — replaying animate-pop-in — the instant it actually
          flips from false to true, whether that happens live while this
          page is open or was already true the moment it loaded (a real
          bidding-driven upgrade shows the badge immediately either way;
          see isBidDrivenUpgrade's own doc comment above for what it does
          and doesn't count as "real"). */}
      <div
        key={isBidDrivenUpgrade ? "upgraded" : "standard"}
        className={`mt-4 flex items-center gap-2 text-sm ${
          isBidDrivenUpgrade ? "animate-pop-in rounded-lg bg-brand-gold/10 px-3 py-2 text-gray-700" : "text-gray-600"
        }`}
      >
        <ShippingLine listing={effectiveListing} size="lg" className="flex-1" />
        {isBidDrivenUpgrade && (
          <span className="shrink-0 rounded-full bg-brand-gold/20 px-2 py-0.5 text-[11px] font-semibold text-brand-gold">
            Upgraded
          </span>
        )}
      </div>
      {effective.signatureRequired && (
        <div
          className={`mt-2 flex items-center gap-2 text-xs ${
            isBidDrivenUpgrade ? "font-medium text-brand-gold" : "text-gray-500"
          }`}
        >
          {/* Same gold as the Quill icon on ListingCard/ListingRow's own
              badges, always — not tied to isBidDrivenUpgrade the way the
              text color is, so this icon reads identically everywhere it
              appears regardless of whether this exact viewing counts as a
              "just happened" upgrade. */}
          <Feather size={14} className="text-brand-gold" />
          Signature required at delivery
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <ShieldCheck size={14} />
        Payment protected — released to the seller after your delivery window
      </div>

      {auctionClosed ? (
        youWonAwaitingPayment ? (
          <div className="mt-4 rounded-lg bg-brand-gold/10 p-3">
            <p className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-gold">
                <Check size={16} /> You won this auction!
              </span>
              {listing.closedAt && <PaymentCountdown dueAt={paymentDueAt(listing)!} />}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              Pay {formatPrice(live.currentPriceCents)} to complete your purchase.
            </p>
            <Link
              href={`/checkout/${listing.id}`}
              className="mt-3 block rounded-lg bg-brand-gold px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light"
            >
              Pay now
            </Link>
          </div>
        ) : (
          <SoldBanner
            label={
              live.outcome === "cancelled"
                ? "The seller ended this auction and voided every bid."
                : youAreWinning
                  ? live.outcome === "bought_now"
                    ? "You bought this — paid."
                    : "You won this auction — paid."
                  : live.outcome === "bought_now"
                    ? "This listing was bought via Buy It Now."
                    : "This auction has ended."
            }
          />
        )
      ) : isOwner ? (
        <OwnerListingBanner />
      ) : isLoggedIn ? (
        <>
          {hasBid && (
            // Keyed on status so a transition (winning <-> outbid) remounts
            // this element and replays the pop-in — a quick, unmissable
            // flash right where the bidder's eyes already are, without a
            // modal or anything that blocks placing the next bid
            // immediately. The content itself is never stale/transient —
            // it's always exactly the current status, not a toast that
            // could disappear while still being true.
            <div
              key={youAreWinning ? "winning" : "outbid"}
              className={`animate-pop-in mt-4 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${
                youAreWinning
                  ? "bg-brand-success/10 text-brand-success"
                  : "bg-brand-urgent/10 text-brand-urgent"
              }`}
            >
              {youAreWinning ? <Check size={16} /> : <AlertTriangle size={16} />}
              {youAreWinning ? (
                <>
                  You&apos;re the top bidder — winning up to{" "}
                  {formatPrice(myMaxBidCents!)}
                </>
              ) : (
                <>You&apos;ve been outbid — raise your max to retake the lead</>
              )}
            </div>
          )}
          <BidBox listing={listing} onBidPlaced={handleBidPlaced} />
          {/* Below the bidding box and the shipping/payment-protected
              lines above (product decision) — reads live.buyItNowPriceCents,
              not listing.buyItNowPriceCents, so it disappears the instant a
              bid lands without needing a page refresh (see `live`'s own doc
              comment). */}
          {live.buyItNowPriceCents && (
            <div className="mt-4 flex flex-col gap-2">
              <BuyNowButton listingId={listing.id} priceCents={live.buyItNowPriceCents} />
              {listing.allowOffers && (
                <MakeOfferButton
                  listingId={listing.id}
                  binPriceCents={live.buyItNowPriceCents}
                  minOfferCents={listing.minOfferCents}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <Link
          href="/login"
          className="mt-4 block rounded-lg bg-brand-navy px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light"
        >
          Sign in to bid
        </Link>
      )}
    </>
  );
}
