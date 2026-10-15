"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileSignature, Loader2 } from "lucide-react";
import { acceptAgreement } from "@/lib/agreements";

const HIGHLIGHTS = [
  "AuctionHous collects payment for you and pays you out once the order completes",
  "Seller fee of 5.50%–7.00% + $0.30 per sale, depending on your tier",
  "Ship every order with tracking within 96 hours",
  "Describe condition honestly — it's the #1 reason for claims",
];

// The one-time Seller Agreement step, shown in place of the Sell wizard /
// Singles Shop until it's accepted. The API enforces the same rule
// (agreement.RequireSeller on listing, singles and payout-setup routes).
export default function SellerAgreementGate({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setSaving(true);
    setError("");
    try {
      await acceptAgreement("seller");
      router.refresh();
    } catch {
      setError("We couldn't save that. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className={`rounded-3xl border border-brand-border bg-white shadow-xl shadow-brand-navy/5 ${compact ? "p-6" : "p-8"}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-navy text-brand-gold-light">
          <FileSignature size={18} />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Before you start selling</h2>
          <p className="text-sm text-gray-500">A one-time step: review and accept the Seller Agreement.</p>
        </div>
      </div>

      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {HIGHLIGHTS.map((h) => (
          <li key={h} className="flex items-start gap-2 rounded-xl bg-brand-surface px-3.5 py-2.5 text-sm text-gray-700">
            <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" /> {h}
          </li>
        ))}
      </ul>

      <label className="mt-5 flex items-start gap-2.5 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-brand-navy"
        />
        <span>
          I agree to the{" "}
          <Link href="/seller-terms" target="_blank" className="font-medium text-brand-navy underline">
            Seller Agreement
          </Link>
          , including appointing AuctionHous to collect payments from buyers on my behalf.
        </span>
      </label>

      {error && <p className="mt-3 text-sm text-brand-urgent">{error}</p>}

      <button
        type="button"
        onClick={accept}
        disabled={!agreed || saving}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-gold px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-gold/30 transition-colors hover:bg-brand-gold-light disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        {saving && <Loader2 size={15} className="animate-spin" />}
        Accept and continue
      </button>
    </div>
  );
}
