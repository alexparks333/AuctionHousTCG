import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Crown, Landmark, ShieldCheck, Sparkles, TrendingDown } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TierFeeExplorer from "@/components/TierFeeExplorer";
import { sellerTierAccentColorClass, sellerTierIconSrc } from "@/lib/types";
import { getCurrentSession } from "@/lib/session";
import { getMe } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

// Design doc v2 §2.7's hard requirement: "Publish the full tier ladder
// openly. Do not advertise a single rate most sellers don't pay." — a
// real, public page, not buried in a settings panel. Numbers here mirror
// apps/api/internal/seller/tier.go and pkg/fees exactly; if either
// changes, update this page to match. icon reuses the same engraved-card
// art shown next to a seller's name everywhere else on the site
// (sellerTierIconSrc) — tiers without art fall back to a plain
// ShieldCheck. accent is this page's own light-background tier color
// (sellerTierAccentColorClass in lib/types.ts is tuned for the dark navy
// banner, not a white card).
const TIERS = [
  {
    name: "New",
    tier: "new" as const,
    rate: "7.00%",
    requirement: "0–14 completed orders",
    accent: "text-gray-500",
    bar: "from-gray-300 to-gray-400",
  },
  {
    name: "Bronze",
    tier: "bronze" as const,
    rate: "6.50%",
    requirement: "15–49 completed orders",
    reviewRequirement: "5+ reviews · 4.0★ avg",
    accent: "text-[#a8672f]",
    bar: "from-[#c98a4f] to-[#a8672f]",
  },
  {
    name: "Silver",
    tier: "silver" as const,
    rate: "6.25%",
    requirement: "50–149 completed orders",
    reviewRequirement: "15+ reviews · 4.3★ avg",
    accent: "text-slate-500",
    bar: "from-slate-300 to-slate-500",
  },
  {
    name: "Gold",
    tier: "gold" as const,
    rate: "6.00%",
    requirement: "150–499 completed orders",
    reviewRequirement: "40+ reviews · 4.5★ avg",
    accent: "text-brand-gold",
    bar: "from-brand-gold-light to-brand-gold",
  },
  {
    name: "Platinum",
    tier: "platinum" as const,
    rate: "5.50%",
    requirement: "500+ completed orders",
    reviewRequirement: "100+ reviews · 4.5★ avg",
    accent: "text-[#8a8f98]",
    bar: "from-[#c4c8cf] to-[#8a8f98]",
  },
  {
    name: "Hous Trust",
    tier: "hous_trust" as const,
    rate: "Custom",
    requirement: "Platinum + application",
    reviewRequirement: "By invitation only",
    accent: "text-sky-600",
    bar: "from-sky-300 to-sky-600",
  },
];

// The rate every bar on the ladder is measured against.
const EBAY_RATE_PCT = 13.75;

// The rules a seller has to meet to move up, beyond the order count.
const PROMOTION_RULES = [
  "Cancelled and refunded orders never count toward your total",
  "Dispute rate under 2% over the last 90 days",
  "No unresolved claim older than 7 days",
  "Account at least 14 days old",
  "The review count and rating shown on the tier you're moving into",
];

// The fee explorer below can't do live math against "Custom" — Hous
// Trust's rate is negotiated per seller, there's no one number to plug
// in — so it only ever gets the tiers with a real, fixed percentage.
// TierFeeExplorer's own fallback (tiers[0] when the selected/initial tier
// isn't in the list) means a Hous Trust viewer just lands on New here,
// same as anyone else visiting the page logged out.
const EXPLORABLE_TIERS = TIERS.filter((t) => t.tier !== "hous_trust");

export default async function TiersPage() {
  // Same session-then-tier read as Header (and both are cache()-wrapped,
  // so this doesn't cost a second round trip to Supabase/the Go API) —
  // what lets the fee explorer below start pre-selected on the viewer's
  // own tier. Logged-out (or a Go API hiccup) falls back to "new", the
  // same real default every user row starts at, not a guess.
  const { session } = isSupabaseConfigured() ? await getCurrentSession() : { session: null };
  const me = session ? await getMe(session.access_token).catch(() => null) : null;
  const myTier = me?.tier ?? "new";
  // Distinct from myTier above: highlighting a card needs the opposite
  // default — an anonymous visitor isn't "New", they're not signed in at
  // all, so only highlight once we've confirmed the viewer's real tier.
  const highlightTier = me?.tier ?? null;
  const current = TIERS.find((t) => t.tier === highlightTier) ?? null;
  const currentIndex = current ? TIERS.indexOf(current) : -1;
  const next = currentIndex >= 0 && currentIndex < TIERS.length - 1 ? TIERS[currentIndex + 1] : null;

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      {/* Page-load card-flip reveal is pure CSS so it works from a server
          component — no client-side JS needed just to animate once on
          mount. Scoped here since nothing else on the site uses it. */}
      <style>{`
        @keyframes tierCardFlip {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(180deg); }
        }
        @keyframes tierRowIn {
          0% { opacity: 0; transform: translateY(14px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .tier-anim { animation-duration: 1ms !important; animation-delay: 0ms !important; }
        }
      `}</style>
      <Header />

      {/* ── Banner ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 text-white">
        <div aria-hidden className="absolute -right-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-gold/20 blur-3xl" />
        <div aria-hidden className="absolute -bottom-48 left-1/4 h-96 w-[40rem] rounded-full bg-sky-400/10 blur-3xl" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />

        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 pb-24 pt-12 sm:px-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-gold/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-gold-light ring-1 ring-brand-gold/30">
              <Sparkles size={13} /> Seller fees, in full
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
              Sell more,
              <br />
              <span className="bg-gradient-to-r from-brand-gold-light via-amber-200 to-brand-gold bg-clip-text text-transparent">
                pay less.
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-base text-white/70">
              Every seller starts at <span className="font-semibold text-white">New</span>. Complete orders with a
              clean dispute record and your rate drops automatically — no application, nothing to ask for. Most
              sellers land on <span className="font-semibold text-brand-gold-light">Gold</span> (6% + $0.30).{" "}
              <span className="font-semibold text-sky-300">Hous Trust</span> is an invitation-only rate we
              negotiate with top Platinum sellers.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/sell"
                className="group inline-flex items-center gap-2 rounded-full bg-brand-gold px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-gold/30 transition-all hover:bg-brand-gold-light hover:shadow-brand-gold/50"
              >
                Start selling
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#calculator"
                className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-6 py-3 text-sm font-semibold ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-white/[0.12]"
              >
                <TrendingDown size={15} /> See what you keep
              </a>
            </div>
          </div>

          {/* Your rate — or the starting rate when signed out. */}
          <div className="relative mx-auto w-full max-w-sm">
            <div aria-hidden className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-brand-gold/30 to-sky-400/10 blur-2xl" />
            <div className="relative rounded-3xl bg-white/[0.07] p-6 ring-1 ring-white/15 backdrop-blur-md">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                {current ? "Your seller rate" : "Everyone starts at"}
              </p>
              <div className="mt-3 flex items-center gap-4">
                <TierIcon tier={current?.tier ?? "new"} size="lg" dark />
                <div>
                  <p
                    className={`text-sm font-semibold ${current ? sellerTierAccentColorClass(current.tier) : "text-white/80"}`}
                  >
                    {(current ?? TIERS[0]).name}
                  </p>
                  <p className="text-4xl font-extrabold tracking-tight text-brand-gold-light">
                    {(current ?? TIERS[0]).rate}
                  </p>
                  <p className="text-xs text-white/50">+ $0.30 per sale</p>
                </div>
              </div>
              <div className="mt-5 rounded-2xl bg-white/[0.06] px-4 py-3 text-sm ring-1 ring-white/10">
                {next?.tier === "hous_trust" ? (
                  <p className="text-white/70">
                    <span className="font-semibold text-white">Next up: Hous Trust</span> — an invitation-only rate we
                    negotiate with top Platinum sellers.
                  </p>
                ) : next ? (
                  <p className="text-white/70">
                    <span className="font-semibold text-white">Next up: {next.name}</span> at {next.rate} —{" "}
                    {next.requirement.toLowerCase()}.
                  </p>
                ) : current ? (
                  <p className="text-white/70">You&apos;re at the top of the ladder.</p>
                ) : (
                  <p className="text-white/70">
                    Other providers charge <span className="font-semibold text-white">{EBAY_RATE_PCT}%</span>. Our highest rate
                    is half that.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="relative mx-auto -mt-14 w-full max-w-6xl flex-1 px-6 pb-16 sm:px-10">
        {/* ── The ladder ─────────────────────────────────────────────── */}
        <section className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-brand-border sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-gray-900">The tier ladder</h2>
              <p className="mt-1 text-sm text-gray-500">
                Each bar is the rate next to other providers&apos; {EBAY_RATE_PCT}% — shorter is better.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              <TrendingDown size={13} /> Your rate drops automatically
            </span>
          </div>

          {/* Cards deal in one by one, and each icon flips face-up — the
              face-down side is a plain AuctionHous card back. */}
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TIERS.map((t, i) => {
              const isCurrent = t.tier === highlightTier;
              const pct = Number.parseFloat(t.rate);
              const isCustom = !Number.isFinite(pct);
              return (
                <li
                  key={t.name}
                  className={`tier-anim group relative flex flex-col rounded-2xl p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                    isCurrent
                      ? "bg-gradient-to-br from-amber-50 to-white ring-2 ring-brand-gold shadow-md shadow-brand-gold/15"
                      : "bg-brand-surface/60 ring-1 ring-brand-border hover:bg-white"
                  }`}
                  style={{
                    animation: "tierRowIn 0.5s ease forwards",
                    animationDelay: `${i * 90}ms`,
                    opacity: 0,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="relative h-14 w-14 shrink-0" style={{ perspective: "700px" }}>
                      <div
                        className="tier-anim absolute inset-0"
                        style={{
                          transformStyle: "preserve-3d",
                          animation: "tierCardFlip 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                          animationDelay: `${i * 90 + 250}ms`,
                        }}
                      >
                        <div
                          className="absolute inset-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-700 shadow-inner"
                          style={{ backfaceVisibility: "hidden" }}
                        >
                          <Image src="/logo-v3.png" alt="" width={24} height={24} className="opacity-70" unoptimized />
                        </div>
                        <div
                          className="absolute inset-0"
                          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                        >
                          <TierIcon tier={t.tier} />
                        </div>
                      </div>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 ring-1 ring-brand-border">
                      Step {i + 1}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <h3 className="text-lg font-bold text-gray-900">{t.name}</h3>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        <Crown size={10} /> Your tier
                      </span>
                    )}
                  </div>
                  <p className={`mt-1 text-3xl font-extrabold tracking-tight ${t.accent}`}>
                    {t.rate}
                    {!isCustom && <span className="ml-1.5 text-sm font-medium text-gray-400">+ $0.30</span>}
                  </p>

                  {/* Rate vs. other providers. */}
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200/70">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${t.bar}`}
                      style={{ width: isCustom ? "35%" : `${(pct / EBAY_RATE_PCT) * 100}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-gray-400">
                    {isCustom ? "Negotiated per seller" : `${(EBAY_RATE_PCT - pct).toFixed(2)} pts under other providers`}
                  </p>

                  <ul className="mt-4 space-y-1.5 border-t border-brand-border/70 pt-4 text-xs text-gray-600">
                    <li className="flex items-center gap-2">
                      <Check size={13} className="shrink-0 text-emerald-500" /> {t.requirement}
                    </li>
                    {"reviewRequirement" in t && (
                      <li className="flex items-center gap-2">
                        <Check size={13} className="shrink-0 text-emerald-500" /> {t.reviewRequirement}
                      </li>
                    )}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>

        {/* ── Calculator ─────────────────────────────────────────────── */}
        <section id="calculator" className="mt-8 scroll-mt-24 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-brand-border sm:p-8">
          <h2 className="text-xl font-bold tracking-tight text-gray-900">What that looks like</h2>
          <p className="mt-1 text-sm text-gray-500">Pick a tier to see what you keep on a sale, next to other providers.</p>
          <div className="mt-5">
            <TierFeeExplorer tiers={EXPLORABLE_TIERS} initialTier={myTier} />
          </div>
        </section>

        {/* ── Rules + bank transfer ──────────────────────────────────── */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-brand-border sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-navy text-brand-gold-light">
                <ShieldCheck size={18} />
              </span>
              <h2 className="text-lg font-bold text-gray-900">How moving up works</h2>
            </div>
            <ul className="mt-5 space-y-3">
              {PROMOTION_RULES.map((rule) => (
                <li key={rule} className="flex items-start gap-3 text-sm text-gray-600">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
                    <Check size={12} />
                  </span>
                  {rule}
                </li>
              ))}
            </ul>
            <p className="mt-5 rounded-2xl bg-brand-surface px-4 py-3 text-xs text-gray-500">
              The rating average blends all three axes (condition accuracy, shipping speed, trustworthiness) across
              every review you&apos;ve ever received, not just recent ones.
            </p>
          </section>

          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 p-6 text-white shadow-sm sm:p-8">
            <div aria-hidden className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-brand-gold/25 blur-3xl" />
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-brand-gold-light ring-1 ring-white/15">
              <Landmark size={18} />
            </span>
            <h2 className="relative mt-4 text-lg font-bold">Buyers save by paying with bank transfer</h2>
            <p className="relative mt-2 text-sm text-white/70">
              At checkout, buyers can pay by card (the listed price) or by bank — a real discount, never a card
              surcharge.
            </p>
            <p className="relative mt-4 rounded-2xl bg-white/[0.07] px-4 py-3 text-sm text-white/80 ring-1 ring-white/10">
              Your payout is identical either way. The bank discount comes out of{" "}
              <span className="font-semibold text-brand-gold-light">our margin, never yours.</span>
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

// A tier's engraved card art, or a plain shield for tiers without art.
function TierIcon({
  tier,
  size = "md",
  dark = false,
}: {
  tier: (typeof TIERS)[number]["tier"];
  size?: "md" | "lg";
  dark?: boolean;
}) {
  const icon = sellerTierIconSrc(tier);
  const box = size === "lg" ? "h-16 w-16" : "h-14 w-14";
  const img = size === "lg" ? 48 : 40;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl ${box} ${
        dark ? "bg-white/10 ring-1 ring-white/15" : "bg-white shadow-inner ring-1 ring-brand-border"
      }`}
    >
      {icon ? (
        <Image src={icon} alt="" width={img} height={img} unoptimized />
      ) : (
        <ShieldCheck size={size === "lg" ? 30 : 26} className={dark ? "text-brand-gold-light" : "text-gray-400"} />
      )}
    </span>
  );
}
