"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { checkEmailVerify, startEmailVerify } from "@/lib/api";
import CodeInput from "@/components/CodeInput";

// The actual interactive KYC level 1 email flow — lives on its own page
// (app/verify/email) rather than inline in Account Settings, which only
// ever shows read-only progress (KycSummary) and a link here. Unlike
// PhoneVerifyForm, there's no address to type in: the code always goes to
// the account's own email (internal/emailverify.HandleStartVerify reads it
// server-side), so this is just "send" then "confirm."
export default function EmailVerifyForm({
  email,
  alreadyVerified,
}: {
  email: string;
  alreadyVerified: boolean;
}) {
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(alreadyVerified);

  async function handleSend() {
    setBusy(true);
    setError("");
    try {
      await startEmailVerify();
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a code.");
    } finally {
      setBusy(false);
    }
  }

  // Fires the instant CodeInput's 6th box is filled — no separate
  // "Confirm" click needed.
  async function handleCheck(code: string) {
    setBusy(true);
    setError("");
    try {
      await checkEmailVerify(code);
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-brand-success/10 px-4 py-3 text-sm font-medium text-brand-success">
        <CheckCircle2 size={16} /> Your email is verified.
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      {!sent ? (
        <>
          <p className="text-center text-sm text-gray-700">
            We&apos;ll send a one-time code to <span className="font-medium text-gray-900">{email}</span>.
          </p>
          <button
            type="button"
            onClick={handleSend}
            disabled={busy}
            className="flex w-fit items-center gap-1.5 rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy/90 disabled:opacity-60"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Send code
          </button>
        </>
      ) : (
        <>
          <label className="text-center text-xs font-medium text-gray-600">Enter the code sent to {email}</label>
          <div className="flex w-full items-center justify-center gap-3">
            <CodeInput onComplete={handleCheck} disabled={busy} />
            {busy && <Loader2 size={16} className="animate-spin text-gray-400" />}
          </div>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setError("");
            }}
            className="w-fit text-xs text-gray-500 hover:underline"
          >
            Resend code
          </button>
        </>
      )}
      {error && <p className="text-center text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}
