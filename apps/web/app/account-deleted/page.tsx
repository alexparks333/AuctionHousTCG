import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Account deleted | AuctionHous - TCG",
};

// Where Account Settings' "Delete account" lands once the deletion has gone
// through and the session has been cleared.
export default function AccountDeletedPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-brand-border">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
            <CheckCircle2 size={26} />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-gray-900">Your account has been deleted</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your personal details and login are gone. Thanks for trading with us — you&apos;re always welcome back with a
            new account.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-full bg-brand-navy px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light"
          >
            Back to AuctionHous
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
