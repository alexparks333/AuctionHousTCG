"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileCheck2, Loader2 } from "lucide-react";
import { acceptAgreement } from "@/lib/agreements";
import { createClient } from "@/lib/supabase/client";

// Shown by Header to any signed-in member who hasn't accepted the current
// Terms of Service: Google sign-ups (which skip the sign-up form's
// checkbox), existing members, and everyone after a new version is
// published. It can't be dismissed — only accepted, or signed out of. The
// API refuses writes until it's accepted (platform.WithBanGuard), so this is
// the friendly front for a rule enforced server-side.
export default function TermsAcceptModal({ isUpdate }: { isUpdate: boolean }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  async function accept() {
    setSaving(true);
    setError("");
    try {
      await acceptAgreement("terms");
      // Close right away once it's saved; the page refreshes behind it
      // rather than keeping the spinner up for the whole reload.
      setAccepted(true);
      router.refresh();
    } catch {
      setError("We couldn't save that. Please try again.");
      setSaving(false);
    }
  }

  async function signOut() {
    await createClient().auth.signOut();
    window.location.assign("/");
  }

  if (accepted) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-brand-navy/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md animate-step-enter overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 px-6 py-5 text-white">
          <div aria-hidden className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-brand-gold/25 blur-2xl" />
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-brand-gold-light ring-1 ring-white/15">
            <FileCheck2 size={18} />
          </span>
          <h2 id="terms-modal-title" className="relative mt-3 text-lg font-bold">
            {isUpdate ? "We've updated our Terms" : "One last step"}
          </h2>
          <p className="relative mt-1 text-sm text-white/70">
            {isUpdate
              ? "Please review and accept the latest Terms to keep using AuctionHous."
              : "Please review and accept our Terms to start buying and selling."}
          </p>
        </div>

        <div className="p-6">
          <label className="flex items-start gap-2.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-brand-navy"
            />
            <span>
              I&apos;m at least 18 and I agree to the{" "}
              <Link href="/terms" target="_blank" className="font-medium text-brand-navy underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" target="_blank" className="font-medium text-brand-navy underline">
                Privacy Policy
              </Link>
              , including the arbitration agreement in the Terms.
            </span>
          </label>

          {error && <p className="mt-3 text-sm text-brand-urgent">{error}</p>}

          <button
            type="button"
            onClick={accept}
            disabled={!agreed || saving}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand-gold px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-gold/30 transition-colors hover:bg-brand-gold-light disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Accept and continue
          </button>
          <button
            type="button"
            onClick={signOut}
            className="mt-2 w-full rounded-full px-5 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-800"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
