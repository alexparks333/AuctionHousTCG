"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronRight, Loader2, MoreHorizontal, Play, X } from "lucide-react";
import Avatar from "./Avatar";
import { devAdvanceOrder, releaseOrderNow, type Order, type OrderState } from "@/lib/api";
import { ORDER_OFF_PATH_LABELS, ORDER_STEPS, currentStepIndex } from "@/lib/orderSteps";
import { PAYMENT_WINDOW_MS } from "@/lib/types";
import PaymentCountdown from "./PaymentCountdown";
import ClaimWindowCountdown from "./ClaimWindowCountdown";

// States DevAdvanceArrow knows how to push forward one step — mirrors
// apps/api/internal/order.DevAdvance's own switch exactly (awaiting_ship ->
// shipped, shipped -> delivered+claim_window, claim_window -> released).
// Every other state (paid/created/etc. resolve to awaiting_ship within the
// same request that creates them, so a real order is never seen sitting in
// one; released/refunded/cancelled/claim_open are all dead ends) has
// nothing for this button to do, so it just doesn't render.
const DEV_ADVANCEABLE_STATES: OrderState[] = ["awaiting_ship", "shipped", "claim_window"];

// Where a step's bubble goes when it's the current one — one place for all
// of this rather than an inline ternary chain per step, since each step's
// destination has its own reasoning:
// - Paid: diverges by viewer role, and only while state is genuinely
//   unpaid ("created" — payment_pending, ACH already submitted and just
//   clearing, has nothing to click). A buyer needs to actually pay, so
//   goes to the real checkout page. A seller can never pay for their own
//   item — the listing page's own owner-vs-buyer logic (OwnerListingBanner
//   while live, a plain "sold" banner once ended) already says so without
//   this needing its own copy.
// - Awaiting shipment / Shipped: the same /order/{id} page either way for
//   "awaiting shipment" (TransactionsList's actionHref) — the seller gets
//   actionable fulfillment controls there, the buyer a read-only view of
//   the same order. "Shipped" goes one level deeper, to the dedicated
//   tracking page (real carrier checkpoints, not just the order's own
//   shipped_at timestamp) — same page for both sides, since tracking
//   history is read-only for everyone regardless of role.
function resolveStepHref(
  stepState: OrderState,
  orderState: OrderState,
  listingId: string,
  viewerIsSeller: boolean,
  actionHref: string | undefined,
): string | undefined {
  if (stepState === "paid" && orderState === "created") {
    return viewerIsSeller ? `/listing/${listingId}` : `/checkout/${listingId}`;
  }
  // Waiting to ship (Shipped is the in-progress step): the order page.
  if (stepState === "shipped" && orderState === "awaiting_ship" && actionHref) {
    return actionHref;
  }
  // In transit (Delivered is the in-progress step): the tracking page.
  if (stepState === "delivered" && orderState === "shipped") {
    return `/order/${listingId}/tracking`;
  }
  // Claim window: the same /order/{id} page as every other current-step
  // link — that's where the real claim form lives (ClaimPanel), so
  // clicking the bubble itself is how a buyer gets there, rather than a
  // separate "File a Claim" link competing with the Play bubble next to it.
  if (stepState === "claim_window" && actionHref) {
    return actionHref;
  }
  return undefined;
}

// The Transactions list's per-row progress stepper — modeled directly on
// csfloat.com/profile/trades' trade-completion row (seller avatar on the
// left, buyer avatar on the right, a connected line of checkpoint bubbles
// between them), translated to this app's light theme and its own real
// order lifecycle (ORDER_STEPS) instead of a fixed 4-step trade ladder.
// Seller/Buyer are always shown in that fixed left-to-right order —
// unlike TransactionsList's "Buying from X"/"Selling to X" header line
// (viewer-relative), this row is role-relative, with the viewer's own side
// called out via the "You" tag instead of reordering the row per viewer.
export default function TransactionStepper({
  listingId,
  sellerUsername,
  buyerUsername,
  viewerIsSeller,
  state,
  rail,
  createdAt,
  claimDeadline,
  actionHref,
  onAdvanced,
}: {
  listingId: string;
  sellerUsername?: string;
  buyerUsername?: string;
  viewerIsSeller: boolean;
  state: OrderState;
  // Order.rail — undefined only for a won-auction order that's still
  // sitting in "created" (FinalizePayment is what stamps it, whether the
  // buyer pays by card or ACH). That makes "cancelled AND no rail" a
  // reliable signal that this specific order never even started paying,
  // as opposed to a ship-timeout or ACH-failure cancellation, both of
  // which only ever happen after rail is already set — see
  // showsUnpaidCancelledX below.
  rail?: "card" | "ach";
  // When state is "created" (the order exists but the buyer hasn't paid
  // yet — see createPendingOrderForWin), this order's own createdAt IS the
  // moment the auction closed: the row is inserted right then, before any
  // payment attempt. That makes it the correct start time for the 24h
  // payment window, same PAYMENT_WINDOW_MS constant AuctionPriceBox/
  // BidsTable already race against — no need to separately thread the
  // listing's closedAt down into this component too.
  createdAt: string;
  // Order.claimDeadline — feeds the live countdown shown under the Claim
  // window bubble while it's the buyer's current step (ClaimWindowCountdown),
  // same field the Transactions list's own status-line countdown reads.
  // Undefined outside claim_window (or on an order created before this
  // field existed), in which case the countdown just doesn't render.
  claimDeadline?: string;
  // Where the "Awaiting shipment" step goes when it's clickable, for both
  // sides of the trade — the same /order/{id} page either way (see
  // TransactionsList), just rendered differently per viewerIsSeller
  // (OrderStatusPanel): the seller gets the actionable label-buying/
  // fulfillment controls, the buyer gets a read-only status view of the
  // exact same order. Originally seller-only, back when clicking through
  // was framed as "the step IS the Ship Now button" — a buyer wanting to
  // check on their own order's status is just as real a reason to click.
  actionHref?: string;
  // Wired up to DevAdvanceArrow below — lets the parent (TransactionsList)
  // patch its own order list with whatever DevAdvance actually returned,
  // same "caller owns the state update" shape as PrintLabelButton's
  // onLabelChanged.
  onAdvanced?: (order: Order) => void;
}) {
  const offPath = ORDER_OFF_PATH_LABELS[state];
  const currentIndex = currentStepIndex(state);
  // The Released-to-seller Play bubble hangs the countdown below it,
  // positioned out of flow so it doesn't drag that bubble out of
  // alignment with its siblings (see isManualReleaseStep below). That
  // line needs room reserved for it in the row's own box —
  // overflow-x-auto below forces overflow-y to compute as auto too (a
  // real CSS rule: a container can't be visible on one axis and not the
  // other), so content that overflows the row's bottom edge gets clipped
  // rather than spilling out the way a plain "visible" box would let it.
  const showsClaimWindowAction = state === "claim_window" && !viewerIsSeller;
  // Same out-of-flow treatment applies to the Paid bubble's "Needs
  // Payment" countdown (below, in labelText) — state === "created" is
  // exactly when that bubble is showing it (needsPayment's own
  // condition), so it needs the same reserved room. Deeper than the
  // claim-window countdown alone, since "Payment window expired" can
  // wrap to two lines.
  const showsDeepExtraLine = showsClaimWindowAction || state === "created";
  // A won-auction order the buyer never paid for gets its own bubble-row
  // treatment instead of collapsing into the generic offPath pill below
  // (cancelled-with-a-refund, refunded, claim-open) — the "Paid" bubble
  // renders as a red X so it's visible at a glance *which* step this
  // order died on, rather than a pill that just says "Cancelled." Scoped
  // deliberately to this one, cleanly-determinable case (see the `rail`
  // prop's own doc comment) rather than guessing at every other
  // cancellation reason's failed step too.
  const showsUnpaidCancelledX = state === "cancelled" && !rail;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState("");

  async function handleRelease() {
    setReleasing(true);
    setReleaseError("");
    try {
      const updated = await releaseOrderNow(listingId);
      onAdvanced?.(updated);
      setConfirmOpen(false);
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setReleasing(false);
    }
  }

  return (
    <div
      className={`flex items-center gap-1 overflow-x-auto px-1 pt-2 ${
        // Baseline pb-6 always accounts for the "You" tag under whichever
        // PartyEndpoint the viewer is — that's on every row, not
        // conditional. pb-10 additionally covers the deeper claim-window/
        // needs-payment countdown when either of those is also showing.
        showsDeepExtraLine ? "pb-10" : "pb-6"
      }`}
    >
      <PartyEndpoint role="Seller" username={sellerUsername} isViewer={viewerIsSeller} />

      {offPath && !showsUnpaidCancelledX ? (
        <>
          <Connector done={false} tone="urgent" />
          <div className="shrink-0 rounded-full bg-brand-urgent/10 px-4 py-2 text-xs font-semibold text-brand-urgent">
            {offPath}
          </div>
          <Connector done={false} tone="urgent" />
        </>
      ) : (
        ORDER_STEPS.map((step, i) => {
          // The last step (released) is the one place currentIndex can
          // point at a step that's already finished, not "in progress" —
          // every other step's currentIndex means "this is what's
          // happening right now" (awaiting shipment, the claim window
          // ticking down), but there's no further action once an order
          // has actually reached released. Without this, the bubble sat
          // gold-with-dots forever on a fully complete order (the "Buying
          // from Seller · Complete" case) instead of reading as done like
          // every step before it.
          const isFinishedTerminalStep = i === ORDER_STEPS.length - 1 && state === "released";
          const done = (currentIndex >= 0 && i < currentIndex) || isFinishedTerminalStep;
          const isCurrent = i === currentIndex && !isFinishedTerminalStep;
          const reached = currentIndex >= 0 && i <= currentIndex;

          const stepHref = isCurrent
            ? resolveStepHref(step.state, state, listingId, viewerIsSeller, actionHref)
            : undefined;
          const clickable = Boolean(stepHref);

          // The buyer's manual early-release override: while the order is
          // sitting in its claim_deadline countdown (delivered, not yet
          // released), the "Release to seller" bubble — otherwise just an
          // unreached gray circle, since claim_window is still the current
          // step — becomes a real forward-progression control instead,
          // active side by side with the Claim window step's own current
          // (gold dots) bubble. Seller-side is never shown this — a seller
          // releasing their own funds early isn't a real action, it's just
          // what the claim-window timer already does for them on schedule.
          const isManualReleaseStep = step.state === "released" && state === "claim_window" && !viewerIsSeller;

          // The step this order actually died on, when it's the specific
          // never-paid cancellation showsUnpaidCancelledX identifies —
          // rendered as a red X instead of the usual gray "not reached"
          // circle every later step still gets, so it's visible at a
          // glance which step failed rather than just that the order is
          // dead somewhere.
          const isFailedPaidStep = step.state === "paid" && showsUnpaidCancelledX;
          // Colors the connector immediately before AND after the X
          // bubble red, bracketing the failure the same way the offPath
          // pill's own two urgent connectors bracket it — Connector only
          // applies its tone when done is true, so this passes done
          // itself rather than the usual "was this step actually
          // completed" meaning.
          const connectorIntoUrgent = showsUnpaidCancelledX && (i === 0 || i === 1);

          const bubble = (
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform duration-150 sm:h-9 sm:w-9 ${
                clickable ? "group-hover:scale-110" : ""
              } ${
                done
                  ? "bg-brand-navy text-white"
                  : isCurrent
                    ? "bg-brand-gold text-white ring-4 ring-brand-gold/20"
                    : "bg-gray-200 text-transparent"
              }`}
            >
              {done && <Check size={16} strokeWidth={3} />}
              {isCurrent && <MoreHorizontal size={18} strokeWidth={3} />}
            </span>
          );
          // "Needs Payment" + a live countdown replaces the plain "Paid"
          // label while this step is current AND the order is genuinely
          // unpaid (state === "created" — payment_pending, ACH already
          // submitted and clearing, isn't "needs payment" anymore even
          // though stepIndexForState still parks it on this same bubble).
          const needsPayment = isCurrent && step.state === "paid" && state === "created";
          const dueAt = needsPayment
            ? new Date(new Date(createdAt).getTime() + PAYMENT_WINDOW_MS).toISOString()
            : undefined;

          const labelText = needsPayment ? (
            <span className="relative flex flex-col items-center text-center">
              <span className="text-[11px] font-semibold leading-tight text-brand-urgent">
                Needs Payment
              </span>
              {/* Positioned out of flow, same reasoning as the Claim
                  window countdown below — "Payment window expired" can
                  wrap to two lines, and letting that grow this column's
                  own flex height is what was dragging this bubble out of
                  line with every plain step's bubble next to it. Centered
                  explicitly (left-1/2 + -translate-x-1/2) at the column's
                  own width rather than relying on this narrower relative
                  parent (sized to "Needs Payment" alone) to center it. */}
              <span className="absolute left-1/2 top-full mt-0.5 w-20 -translate-x-1/2 text-center leading-[0.8] sm:w-24">
                <PaymentCountdown dueAt={dueAt!} className="text-[10px] leading-[0.8]" />
              </span>
            </span>
          ) : (
            <span
              className={`text-center text-[11px] leading-tight ${
                reached ? "font-medium text-gray-900" : "text-gray-400"
              }`}
            >
              {step.label}
            </span>
          );

          return (
            <div key={step.state} className="flex items-center">
              <Connector
                done={connectorIntoUrgent || (i === 0 ? reached : currentIndex >= 0 && i - 1 < currentIndex)}
                tone={connectorIntoUrgent ? "urgent" : "default"}
              />
              {isFailedPaidStep ? (
                <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-24">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-urgent text-white ring-4 ring-brand-urgent/20 sm:h-9 sm:w-9">
                    <X size={16} strokeWidth={3} />
                  </span>
                  <span className="text-center text-[11px] font-medium leading-tight text-brand-urgent">
                    Payment Expired
                  </span>
                </div>
              ) : isManualReleaseStep ? (
                <div className="relative flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-24">
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    title="Release the money to the seller now"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gold text-white ring-4 ring-brand-gold/20 transition-transform duration-150 hover:scale-110 sm:h-9 sm:w-9"
                  >
                    <Play size={16} strokeWidth={3} className="ml-0.5" />
                  </button>
                  <span className="text-center text-[11px] font-medium leading-tight text-gray-900">
                    {step.label}
                  </span>
                  {/* Positioned out of flow on purpose — this column's
                      flex height needs to match every plain step's
                      (bubble + one label line) exactly, or the row's
                      items-center alignment drags this bubble to a
                      different vertical position than the others just
                      because it has more text underneath it. */}
                  {claimDeadline && (
                    <div className="absolute top-full mt-1">
                      <ClaimWindowCountdown deadline={claimDeadline} className="text-[10px]" />
                    </div>
                  )}
                </div>
              ) : clickable ? (
                <Link
                  href={stepHref!}
                  className="group flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-24"
                >
                  {bubble}
                  {labelText}
                </Link>
              ) : (
                <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-24">
                  {bubble}
                  {labelText}
                </div>
              )}
              {isCurrent && DEV_ADVANCEABLE_STATES.includes(state) && (
                <DevAdvanceArrow listingId={listingId} onAdvanced={onAdvanced} />
              )}
            </div>
          );
        })
      )}

      <Connector done={!offPath && currentIndex === ORDER_STEPS.length - 1} tone={offPath ? "urgent" : "default"} />
      <PartyEndpoint role="Buyer" username={buyerUsername} isViewer={!viewerIsSeller} />

      {confirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !releasing) setConfirmOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Release money to seller"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Release Money to Seller</h2>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={releasing}
                aria-label="Close"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-brand-surface hover:text-gray-600 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-3 flex items-start gap-2 text-sm text-gray-600">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-brand-urgent" />
              <span>
                This can not be undone. This confirms everything went right with this transaction and
                sends the money to the seller now, closing it out early instead of waiting for the rest
                of your claim window to elapse.
              </span>
            </p>
            {releaseError && <p className="mt-3 text-xs text-brand-urgent">{releaseError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={releasing}
                className="flex-1 rounded-full border border-brand-border px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-surface disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRelease}
                disabled={releasing}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
              >
                {releasing && <Loader2 size={14} className="animate-spin" />}
                {releasing ? "Releasing..." : "Release Money"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Only ever mounted when NODE_ENV=development — checked inline the same
// way SellWizard's Step3Price hides its 1/2/5-minute dev auction durations
// (CLAUDE.md §6.13), so this whole branch is dead-code-eliminated from
// production bundles, not just hidden. There is no realistic way to test
// the shipping/delivery/claim-window flow end to end otherwise — you can't
// actually mail a card to yourself as part of a dev loop — so this button
// stands in for "the seller shipped it" / "the carrier delivered it" /
// "the claim window elapsed," one real state transition at a time, via the
// exact same MarkShipped/MarkDelivered/release code a real event would
// trigger (apps/api/internal/order/devadvance.go). The backend refuses to
// run this outside development regardless of whether this button is even
// rendered (order.AllowDevAdvance) — same belt-and-suspenders shape as
// every other dev-only affordance in this codebase.
function DevAdvanceArrow({
  listingId,
  onAdvanced,
}: {
  listingId: string;
  onAdvanced?: (order: Order) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (process.env.NODE_ENV !== "development") return null;

  async function advance() {
    setBusy(true);
    setError("");
    try {
      const updated = await devAdvanceOrder(listingId);
      onAdvanced?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Advance failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          advance();
        }}
        disabled={busy}
        title="DEV: simulate the next real-world event (ship / deliver / claim window elapses)"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-amber-400 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={15} strokeWidth={3} />}
      </button>
      <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-amber-600">Dev</span>
      {/* Positioned out of flow — same reasoning as every other extra
          line in this file, so a rare failed-advance error doesn't push
          this button out of line with the bubble row next to it. */}
      {error && (
        <span className="absolute top-full mt-1 max-w-[80px] text-center text-[9px] leading-tight text-brand-urgent">
          {error}
        </span>
      )}
    </div>
  );
}

function Connector({ done, tone = "default" }: { done: boolean; tone?: "default" | "urgent" }) {
  const color = done ? (tone === "urgent" ? "bg-brand-urgent" : "bg-brand-navy") : "bg-gray-200";
  return <span className={`h-0.5 w-6 shrink-0 sm:w-9 ${color}`} />;
}

function PartyEndpoint({
  role,
  username,
  isViewer,
}: {
  role: "Seller" | "Buyer";
  username?: string;
  isViewer: boolean;
}) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 sm:w-20">
      <span className={isViewer ? "rounded-full ring-2 ring-brand-gold ring-offset-2" : ""}>
        <Avatar label={username ?? role} size={40} />
      </span>
      <span className="relative text-center text-[11px] leading-tight text-gray-500">
        {role}
        {/* Positioned out of flow, same reasoning as every other extra
            line in this file — the viewer's own endpoint (Seller or
            Buyer, whichever "You" is) would otherwise be one line taller
            than the other one, and the row's items-center alignment
            would offset the two avatars from each other because of it. */}
        {isViewer && (
          <span className="absolute left-1/2 top-full mt-0.5 w-16 -translate-x-1/2 text-center font-semibold leading-tight text-brand-navy sm:w-20">
            You
          </span>
        )}
      </span>
    </div>
  );
}
