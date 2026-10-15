"use client";

import { useMsLeft } from "@/lib/useMsLeft";
import { formatMsLeft } from "@/lib/types";

// Live "time left until funds auto-release" — sits to the left of the
// status badge on the Transactions list (TransactionsList) for any order
// currently inside its claim_deadline countdown, so neither party has to
// open the order page just to see how long is left before the
// claim-window timer fires the release automatically (or before a buyer's
// own manual override, TransactionStepper's Play-button bubble, closes it
// out early instead). Same useMsLeft/formatMsLeft plumbing as
// PaymentCountdown — its own component, not inlined at the call site, for
// the same reason: a hook can't be called directly inside a .map() loop,
// but a separate component instance per row is exactly what the rules of
// hooks allow.
export default function ClaimWindowCountdown({
  deadline,
  // Lets TransactionStepper's Claim-window bubble render this a size
  // smaller than the Transactions list's status-line usage, same override
  // shape as PaymentCountdown's own className prop.
  className = "text-xs",
}: {
  deadline: string;
  className?: string;
}) {
  const msLeft = useMsLeft(deadline);
  if (msLeft === null || msLeft <= 0) return null;

  return (
    <span
      className={`whitespace-nowrap font-semibold text-brand-gold ${className}`}
      // Same server/client Date.now() skew as every other live countdown
      // on the site — corrects within a second via useMsLeft's own
      // interval, not a real hydration bug.
      suppressHydrationWarning
    >
      {formatMsLeft(msLeft)}
    </span>
  );
}
