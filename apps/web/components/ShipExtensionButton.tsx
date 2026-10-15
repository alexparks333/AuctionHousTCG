"use client";

import { useState } from "react";
import { AlertTriangle, Clock, Loader2, X } from "lucide-react";
import { requestShipExtension, type Order } from "@/lib/api";
import { formatPrice } from "@/lib/types";

// The seller's one-time "I need more time to ship" action — only rendered
// by the caller while state === "awaiting_ship" and shipExtensionUsedAt is
// unset (apps/api/internal/order.RequestShipExtension enforces both
// server-side too). Same confirm-modal pattern as TransactionStepper's
// "Release to Seller" button, since this is equally a real, irreversible,
// money-moving action a seller shouldn't trigger by an accidental click.
export default function ShipExtensionButton({
  order,
  onExtended,
}: {
  order: Order;
  onExtended: (order: Order) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const discountCents = Math.round(order.subtotalCents * 0.1);

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      const updated = await requestShipExtension(order.listingId);
      onExtended(updated);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-navy hover:underline"
      >
        <Clock size={14} /> Request shipping extension
      </button>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setConfirmOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Request shipping extension"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Request Shipping Extension</h2>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                aria-label="Close"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-brand-surface hover:text-gray-600 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-3 flex items-start gap-2 text-sm text-gray-600">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-brand-urgent" />
              <span>
                This gives you 4 more days to ship, but costs you {formatPrice(discountCents)} (10% of
                the item price) — refunded to the buyer as compensation and deducted from your own
                payout. One-time only, and can not be undone.
              </span>
            </p>
            {error && <p className="mt-3 text-xs text-brand-urgent">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="flex-1 rounded-full border border-brand-border px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-surface disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light disabled:opacity-60"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {busy ? "Requesting..." : "Request Extension"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
