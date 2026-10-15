import { AlertOctagon } from "lucide-react";

// Renders in two places: Header (the banned user's own view, every page —
// see Header.tsx) and the public seller profile page (any OTHER viewer's
// view — app/seller/[username]/page.tsx), since the ban is meant to read
// as a dead account to anyone visiting it, not just to the banned user
// themselves (Plan B / CLAUDE.md §7). Purely informational — every
// mutating action already 403s from internal/platform.WithBanGuard
// regardless of what this banner does or doesn't say, so there's no
// enforcement logic here at all.
//
// Deliberately reason-agnostic copy — a ban is either a real chargeback
// (reason 'chargeback_fraud') or ban-evasion detection (reason
// 'ban_evasion', internal/webhook's identity-fingerprint check or
// internal/phoneverify's phone-number reuse check), and this banner has no
// way to know which without a new API field nobody's asked for yet. "Our
// chargeback and account-integrity policies" covers both without being
// wrong about either.
export default function AccountBannedBanner({ variant = "self" }: { variant?: "self" | "profile" }) {
  return (
    <div className="flex items-center gap-2 bg-brand-urgent px-10 py-2 text-sm font-semibold text-white sm:px-12 lg:px-14">
      <AlertOctagon size={16} className="shrink-0" />
      {variant === "self" ? (
        <span>
          Your account is permanently banned for violating our chargeback and account-integrity policies. You
          can still view your account and contact support to appeal.
        </span>
      ) : (
        <span>This account is permanently banned for violating our chargeback and account-integrity policies.</span>
      )}
    </div>
  );
}
