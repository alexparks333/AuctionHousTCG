import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import IdentityVerifyButton from "@/components/IdentityVerifyButton";
import { getCurrentSession } from "@/lib/session";
import { getMe } from "@/lib/api";

// Auth is already guaranteed by app/verify/layout.tsx — this just needs
// the session's access_token to call getMe.
export default async function VerifyIdentityPage() {
  const { session } = await getCurrentSession();
  const me = session ? await getMe(session.access_token).catch(() => null) : null;

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <div className="mx-auto max-w-md">
        <Link
          href="/account/settings"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-brand-navy"
        >
          <ArrowLeft size={15} /> Back to Account Settings
        </Link>
        <h1 className="mt-3 text-xl font-bold text-gray-900">KYC Level 2 — Identity Verification</h1>
        <p className="mt-1 text-sm text-gray-500">
          A government ID and ID-number check, handled entirely by Stripe&apos;s own secure, hosted flow.
          Removes the $75/item purchase cap.
        </p>
        <IdentityVerifyButton
          alreadyVerified={Boolean(me?.identityVerifiedAt)}
          phoneVerified={Boolean(me?.phoneVerifiedAt)}
          emailVerified={Boolean(me?.emailVerifiedAt)}
        />
      </div>
    </div>
  );
}
