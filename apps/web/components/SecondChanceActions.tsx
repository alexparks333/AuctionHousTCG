"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { acceptSecondChanceOffer, declineSecondChanceOffer, type SecondChanceOffer } from "@/lib/api";
import { useMsLeft } from "@/lib/useMsLeft";
import { formatMsLeft } from "@/lib/types";

// The bidder-facing Accept/Decline pair on /second-chance/[id] — Accept
// only ever creates the same real, unpaid order a regular auction win
// creates (apps/api/internal/secondchance.Accept ->
// auction.CreatePendingOrderForWin); payment still goes through the
// normal checkout flow from there, 24h window and all, so this component's
// entire job ends the moment the order exists.
export default function SecondChanceActions({ offer }: { offer: SecondChanceOffer }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");
  const msLeft = useMsLeft(offer.status === "pending" ? offer.expiresAt : undefined);

  if (offer.status !== "pending" || (msLeft !== null && msLeft <= 0)) {
    return (
      <p className="mt-4 rounded-lg bg-brand-surface px-3 py-2 text-xs text-gray-500">
        {offer.status === "accepted"
          ? "You accepted this offer."
          : offer.status === "declined"
            ? "You declined this offer."
            : "This offer has expired."}
      </p>
    );
  }

  async function handleAccept() {
    setBusy("accept");
    setError("");
    try {
      await acceptSecondChanceOffer(offer.id);
      router.push(`/checkout/${offer.listingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(null);
    }
  }

  async function handleDecline() {
    setBusy("decline");
    setError("");
    try {
      await declineSecondChanceOffer(offer.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 border-t border-brand-border pt-4">
      {msLeft !== null && (
        <p className="text-xs font-semibold text-brand-urgent" suppressHydrationWarning>
          {formatMsLeft(msLeft)} to accept
        </p>
      )}
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleAccept}
          disabled={busy !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
        >
          {busy === "accept" && <Loader2 size={14} className="animate-spin" />}
          Buy It Now
        </button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={busy !== null}
          className="flex-1 rounded-full border border-brand-border px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-surface disabled:opacity-50"
        >
          {busy === "decline" ? "Declining..." : "Decline"}
        </button>
      </div>
    </div>
  );
}
