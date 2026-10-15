"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { checkPhoneVerify, startPhoneVerify } from "@/lib/api";
import CodeInput from "@/components/CodeInput";

// Live input mask for a US phone number — "(818) 807-8706" as the user
// types, digits only under the hood. Re-derives from the raw digits on
// every keystroke (rather than trying to patch the previous formatted
// string), which is what makes backspace/paste/mid-string edits all just
// work without extra cursor-position bookkeeping. Purely a display
// convenience: the backend's own NormalizeE164 (internal/phoneverify)
// strips formatting back out before it ever reaches Twilio, so this isn't
// load-bearing for correctness, only for what the user sees while typing.
function formatUSPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// The actual interactive KYC level 1 flow — lives on its own page
// (app/verify/phone) rather than inline in Account Settings,
// which only ever shows read-only progress (KycSummary) and a link here.
export default function PhoneVerifyForm({ alreadyVerified }: { alreadyVerified: boolean }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(alreadyVerified);

  async function handleSend() {
    setBusy(true);
    setError("");
    try {
      await startPhoneVerify(phone);
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
      await checkPhoneVerify(phone, code);
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
        <CheckCircle2 size={16} /> Your phone number is verified.
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      {!sent ? (
        <>
          <label className="text-xs font-medium text-gray-600">Phone number</label>
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatUSPhone(e.target.value))}
              placeholder="(555) 555-5555"
              className="min-w-0 flex-1 rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={busy || !phone}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy/90 disabled:opacity-60"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              Send code
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="text-center text-xs font-medium text-gray-600">Enter the code sent to {phone}</label>
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
            Use a different number
          </button>
        </>
      )}
      {error && <p className="text-center text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}
