import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import SavedBanksManager from "@/components/SavedBanksManager";
import { getCurrentSession } from "@/lib/session";
import { getMe, getSavedBanks } from "@/lib/api";
import { isStripeConfigured } from "@/lib/stripe";

// Auth is already guaranteed by app/verify/layout.tsx — this just needs
// the session's access_token to call getMe/getSavedBanks.
export default async function VerifyBankPage() {
  const { session } = await getCurrentSession();

  const [me, banks] = await Promise.all([
    session ? getMe(session.access_token).catch(() => null) : Promise.resolve(null),
    session && isStripeConfigured() ? getSavedBanks(session.access_token).catch(() => []) : Promise.resolve([]),
  ]);

  const bankVerified = Boolean(me?.bankVerifiedAt);
  const identityVerified = Boolean(me?.identityVerifiedAt);

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <div className="mx-auto max-w-md">
        <Link
          href="/account/settings"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-brand-navy"
        >
          <ArrowLeft size={15} /> Back to Account Settings
        </Link>
        <h1 className="mt-3 text-xl font-bold text-gray-900">KYC Level 3 — Verified Bank Account</h1>
        <p className="mt-1 text-sm text-gray-500">
          A linked, verified bank account is structurally much harder to reverse than a card chargeback —
          this unlocks &quot;Pay by bank instead&quot; at checkout.
        </p>

        {bankVerified ? (
          <div className="mt-6 flex items-center gap-2 rounded-lg bg-brand-success/10 px-4 py-3 text-sm font-medium text-brand-success">
            <CheckCircle2 size={16} /> Your bank account is verified.
          </div>
        ) : !identityVerified ? (
          <p className="mt-6 text-sm text-gray-500">
            Verify your identity first (KYC Level 2) before linking a bank account.
          </p>
        ) : !isStripeConfigured() ? (
          <p className="mt-6 text-sm text-gray-500">Bank linking isn&apos;t configured yet.</p>
        ) : (
          <>
            <p className="mt-6 text-xs text-gray-500">
              Link a bank account below — verifying it (instantly, or via two small deposits) automatically
              advances this level.
            </p>
            <SavedBanksManager initialBanks={banks} />
          </>
        )}
      </div>
    </div>
  );
}
