import { redirect } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SellWizard from "@/components/SellWizard";
import SellerPayoutsSetup from "@/components/SellerPayoutsSetup";
import SellerAgreementGate from "@/components/SellerAgreementGate";
import TermsAcceptModal from "@/components/TermsAcceptModal";
import { getAgreementStatus } from "@/lib/agreements";
import { getSellerConnectStatus, type SellerConnectStatus } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { isStripeConfigured } from "@/lib/stripe";
import { getCurrentSession } from "@/lib/session";

export default async function SellPage() {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  // getCurrentSession() is cache()'d — Header (rendered below) calls it
  // too, so this shares that one call instead of paying for a second,
  // separate round trip to Supabase's Auth server just to check login.
  const { session, user } = await getCurrentSession();

  if (!user || !session) {
    redirect("/login");
  }

  // Gated server-side, not just a UI nicety: apps/api/internal/listing.
  // Create rejects the actual POST /listings call too
  // (RequireSellerOnboarded) if Stripe is configured and this seller
  // hasn't finished Connect onboarding — a direct API call can't bypass
  // this prompt, only skip seeing it. Skipped entirely when Stripe isn't
  // configured at all (local dev without keys), same graceful-degradation
  // posture as everywhere else Stripe is optional in this codebase.
  let connectStatus: SellerConnectStatus | null = null;
  if (isStripeConfigured()) {
    connectStatus = await getSellerConnectStatus(session.access_token).catch(() => null);
  }
  const needsOnboarding = connectStatus !== null && !connectStatus.chargesEnabled;
  // The Seller Agreement comes first — the API refuses payout setup and new
  // listings until it's accepted. null (API unreachable) falls through to
  // the wizard, whose own submit the API still gates.
  const agreements = await getAgreementStatus(session.access_token);
  const needsSellerAgreement = agreements !== null && !agreements.seller;

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header variant="logo-only" />
      {/* The logo-only header skips the account fetch that normally shows
          this, so the Sell page shows it itself. */}
      {agreements && !agreements.terms && <TermsAcceptModal isUpdate={false} />}
      {/* Navy banner like the profile page's cover band; the wizard card
          overlaps its bottom edge. */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 text-white">
        <div aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-gold/25 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 left-1/4 h-64 w-[28rem] rounded-full bg-sky-400/10 blur-3xl" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "18px 18px",
          }}
        />
        <div className="relative mx-auto w-full max-w-4xl px-4 pb-24 pt-10 sm:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-gold-light">Sell on AuctionHous</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Create a listing</h1>
          <p className="mt-2 max-w-xl text-white/70">
            List a card as an auction or a fixed-price Buy It Now. Buyers pay securely through Stripe.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-white/80">
            {["Low seller fees", "Autofill from the card catalog", "Tracked shipping labels"].map((t) => (
              <li key={t} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15">
                <Check size={13} className="text-brand-gold-light" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <main className="relative mx-auto -mt-16 w-full max-w-4xl flex-1 px-4 pb-14 sm:px-8">

        {needsSellerAgreement ? (
          <SellerAgreementGate />
        ) : needsOnboarding && connectStatus ? (
          <div className="rounded-3xl border border-brand-border bg-white p-8 shadow-xl shadow-brand-navy/5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
                <ShieldCheck size={16} />
              </span>
              <h2 className="text-lg font-semibold text-gray-900">
                Set up payouts before you list
              </h2>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Before anyone can buy from you, Stripe needs to verify who you are and where your sale
              proceeds go — a one-time, few-minute setup. Once an order completes, your earnings are
              transferred to this Stripe account and you can withdraw them to your bank.
            </p>
            <SellerPayoutsSetup initialStatus={connectStatus} returnPath="/sell" />
          </div>
        ) : (
          <SellWizard />
        )}
      </main>
      <Footer />
    </div>
  );
}
