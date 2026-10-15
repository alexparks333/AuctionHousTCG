"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { startIdentityVerify } from "@/lib/api";

// KYC level 2's only interactive piece — starts a Stripe Identity hosted
// session and opens it in a NEW tab (window.open, not window.location.href)
// rather than navigating this one away. Stripe's own hosted flow ends with
// "You may close this tab" — a real, live-found gap: navigating the
// CURRENT tab there means there's no AuctionHous tab left to come back to
// once the user does that. The actual verified_at timestamp is only ever
// set later, asynchronously, by internal/webhook's
// identity.verification_session.verified case (a webhook, not this tab's
// own response), so this tab has no way to know the instant it's done —
// "Refresh status" just re-runs the page's server-side me fetch.
export default function IdentityVerifyButton({
  alreadyVerified,
  phoneVerified,
  emailVerified,
}: {
  alreadyVerified: boolean;
  phoneVerified: boolean;
  emailVerified: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function handleStart() {
    setBusy(true);
    setError("");
    try {
      const { url } = await startIdentityVerify();
      window.open(url, "_blank", "noopener,noreferrer");
      setOpened(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start identity verification.");
    } finally {
      setBusy(false);
    }
  }

  function handleRefresh() {
    setRefreshing(true);
    router.refresh();
    // router.refresh() doesn't resolve when the new server data actually
    // lands — just clears the spinner shortly after kicking it off rather
    // than leaving it spinning forever if the result looks identical.
    setTimeout(() => setRefreshing(false), 1500);
  }

  if (alreadyVerified) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-lg bg-brand-success/10 px-4 py-3 text-sm font-medium text-brand-success">
        <CheckCircle2 size={16} /> Your identity is verified.
      </div>
    );
  }

  if (!phoneVerified || !emailVerified) {
    return (
      <p className="mt-6 text-sm text-gray-500">
        Verify your phone number and email first (KYC Level 1) before starting identity verification.
      </p>
    );
  }

  if (opened) {
    return (
      <div className="mt-6">
        <p className="text-sm text-gray-700">
          Complete the verification in the new tab that just opened. When Stripe says you&apos;re done and to
          close that tab, come back here and refresh your status — verification finishes a moment after
          Stripe confirms it, not instantly.
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="mt-3 flex items-center gap-1.5 rounded-full border border-brand-border px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh status
        </button>
        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          className="mt-3 block text-xs text-gray-500 hover:underline disabled:opacity-60"
        >
          Didn&apos;t get a tab? Start again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy/90 disabled:opacity-60"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        Verify your identity
      </button>
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
      <p className="mt-3 text-xs text-gray-500">
        This opens in a new tab so you can come back here when you&apos;re done. We never see or store your
        ID number — only whether Stripe&apos;s check passed.
      </p>
    </div>
  );
}
