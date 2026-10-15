import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";

// The Account Settings summary for the 3-level KYC ladder (Plan B /
// CLAUDE.md §7's chargeback-fraud ban system) — deliberately just a
// read-only progress display with links out, no input fields of any kind.
// Actually completing a level happens on its own dedicated page under the
// top-level /verify route (app/verify/{phone,email,identity,bank}) — a
// half-finished phone-code form buried in a long Settings page was the
// thing this replaced. /verify is deliberately its own top-level route,
// not nested under /account, so its layout can drop both the category-nav
// bubbles and the account-tabs row (app/verify/layout.tsx's own doc
// comment explains why nesting under /account can't do that). Server-
// renderable (no "use client"): every value is already known from the me
// prop, and every action here is a plain navigation.
//
// Level 1 requires BOTH phone AND email verification (internal/kyc's own
// package doc explains why neither alone is a strong enough signal) — the
// two render as sub-requirements under one "Level 1" heading, not as two
// separately-numbered levels, since together they're a single gate: level
// 2 only unlocks once both are done, not once either one is.
export default function KycSummary({
  phoneVerifiedAt,
  emailVerifiedAt,
  identityVerifiedAt,
  bankVerifiedAt,
}: {
  phoneVerifiedAt: string | null;
  emailVerifiedAt: string | null;
  identityVerifiedAt: string | null;
  bankVerifiedAt: string | null;
}) {
  const phoneDone = Boolean(phoneVerifiedAt);
  const emailDone = Boolean(emailVerifiedAt);
  const level1Done = phoneDone && emailDone;
  const level = !level1Done ? 0 : !identityVerifiedAt ? 1 : !bankVerifiedAt ? 2 : 3;

  const level1Requirements = [
    { label: "Phone verification", done: phoneDone, href: "/verify/phone" },
    { label: "Email verification", done: emailDone, href: "/verify/email" },
  ];

  const steps = [
    {
      level: 2,
      label: "Identity verification",
      done: Boolean(identityVerifiedAt),
      unlockable: level1Done,
      href: "/verify/identity",
    },
    {
      level: 3,
      label: "Verified bank account",
      done: Boolean(bankVerifiedAt),
      unlockable: Boolean(identityVerifiedAt),
      href: "/verify/bank",
    },
  ];

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between rounded-lg bg-brand-surface px-4 py-3">
        <span className="text-sm font-medium text-gray-600">Your KYC level</span>
        <span className="text-xl font-bold text-gray-900">
          {level} <span className="text-sm font-normal text-gray-400">/ 3</span>
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {level === 0 && "Verify your phone number and email to bid or buy at all."}
        {level === 1 && "Capped at $75 per item — verify your identity to remove the cap."}
        {level === 2 && "No purchase cap. Verify a bank account to unlock paying by bank."}
        {level === 3 && "Fully verified — no purchase cap, and you can pay by bank."}
      </p>

      <div className="mt-3 rounded-lg border border-brand-border">
        <div
          className={`flex items-center justify-between gap-2.5 px-3 py-2 ${
            level1Done ? "" : "border-b border-brand-border"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {level1Done ? (
              <CheckCircle2 size={17} className="shrink-0 text-brand-success" />
            ) : (
              <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold text-gray-400">
                1
              </span>
            )}
            <span className={`text-sm font-medium ${level1Done ? "text-gray-900" : "text-gray-700"}`}>
              Level 1 — Phone &amp; Email
            </span>
          </div>
          {level1Done && <span className="shrink-0 text-xs font-medium text-brand-success">Verified</span>}
        </div>
        {/* Once both are verified, the whole point of Level 1 is done —
            listing "Phone verification: Verified" / "Email verification:
            Verified" underneath a header that already says the same thing
            is just noise. Collapses away instead of staying expanded
            forever. */}
        {!level1Done && (
          <ul className="flex flex-col divide-y divide-brand-border">
            {level1Requirements.map((req) => (
              <li key={req.href} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  {req.done ? (
                    <CheckCircle2 size={17} className="shrink-0 text-brand-success" />
                  ) : (
                    <span className="h-[17px] w-[17px] shrink-0 rounded-full border border-gray-300" />
                  )}
                  <span className={`text-sm font-medium ${req.done ? "text-gray-900" : "text-gray-700"}`}>
                    {req.label}
                  </span>
                </div>
                {req.done ? (
                  <span className="shrink-0 text-xs font-medium text-brand-success">Verified</span>
                ) : (
                  <Link
                    href={req.href}
                    className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand-navy hover:underline"
                  >
                    Verify <ChevronRight size={13} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="mt-2 flex flex-col gap-2">
        {steps.map((step) => (
          <li
            key={step.level}
            className="flex items-center justify-between gap-3 rounded-lg border border-brand-border px-3 py-2.5"
          >
            <div className="flex items-center gap-2.5">
              {step.done ? (
                <CheckCircle2 size={17} className="shrink-0 text-brand-success" />
              ) : (
                <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold text-gray-400">
                  {step.level}
                </span>
              )}
              <span className={`text-sm font-medium ${step.done ? "text-gray-900" : "text-gray-700"}`}>
                Level {step.level} — {step.label}
              </span>
            </div>
            {step.done ? (
              <span className="shrink-0 text-xs font-medium text-brand-success">Verified</span>
            ) : step.unlockable ? (
              <Link
                href={step.href}
                className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand-navy hover:underline"
              >
                Complete KYC Level {step.level} <ChevronRight size={13} />
              </Link>
            ) : (
              <span className="shrink-0 text-xs text-gray-400">Complete Level {step.level - 1} first</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
