import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BadgeCheck, Flame, Gavel, Percent, ShieldCheck, Tag, TrendingDown, Truck } from "lucide-react";
import FeaturedAuctionCards from "./FeaturedAuctionCards";
import {
  formatPrice,
  formatSellerTier,
  sellerTierAccentColorClass,
  sellerTierIconSrc,
  sellerTierRate,
  type Listing,
} from "@/lib/types";

// The fee the hero compares against — same figure the copy below has always
// quoted for eBay.
const EBAY_FEE_PCT = 13.75;
// The example sale the fee card works through.
const EXAMPLE_SALE_CENTS = 10000;
// Hous Trust has a negotiated ("Custom") rate; the comparison uses the best
// published tier rate for it.
const BEST_PUBLISHED_PCT = 5.5;

// tier is the viewer's own seller trust tier — same reasoning as TopBar's:
// null (logged out, or never sold anything) falls back to the New tier's
// 7.00% rate, since that's the real starting rate rather than a flat
// number nobody actually pays.
export default function Hero({
  featuredAuctions,
  tier = null,
}: {
  featuredAuctions: Listing[];
  tier?: Listing["sellerTier"] | null;
}) {
  const rate = sellerTierRate(tier ?? "new");
  const tierIcon = tier ? sellerTierIconSrc(tier) : null;
  const tierLabel = formatSellerTier(tier ?? "new");

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 text-white">
      {/* Background: soft gold + blue glows over a faint dot grid. */}
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
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-gold/40 to-transparent" />

      <div className="relative grid gap-10 px-6 py-10 sm:px-12 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:px-14 lg:py-10">
        {/* ── Left: pitch ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* One plain bubble — the rate is just bold text, not a separate
              chip, which read like a toggle you could switch. */}
          <span className="flex w-fit flex-wrap items-center gap-x-1.5 rounded-full bg-brand-gold/10 px-5 py-2 text-sm font-medium text-white/80 ring-1 ring-brand-gold/30 backdrop-blur">
            <span className="font-bold text-brand-gold-light">{rate}</span>
            + $0.30 seller fee
            {tier ? (
              <>
                {" · your "}
                <Link href="/tiers" className={`font-semibold hover:underline ${sellerTierAccentColorClass(tier)}`}>
                  {tierLabel}
                </Link>
                {" rate"}
              </>
            ) : (
              " · pay by bank and save"
            )}
          </span>

          <div>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
              The Marketplace
              <br />
              <span className="bg-gradient-to-r from-brand-gold-light via-amber-200 to-brand-gold bg-clip-text text-transparent">
                for the People
              </span>
            </h1>
            <p className="mt-3 max-w-lg text-base text-white/70 sm:text-lg">
              Buy and sell Riftbound grails and singles — without the {EBAY_FEE_PCT}% selling fee. Our goal is
              simple: <span className="font-semibold text-white">keep fees as low as possible.</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="#ending-soon"
              className="group inline-flex items-center gap-2 rounded-full bg-brand-gold px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-gold/30 transition-all hover:bg-brand-gold-light hover:shadow-brand-gold/50"
            >
              Browse listings
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/sell"
              className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-6 py-3 text-sm font-semibold ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-white/[0.12]"
            >
              <Tag size={15} /> Start selling
            </Link>
          </div>

          <dl className="mt-1 grid max-w-xl grid-cols-3 gap-3">
            <StatTile icon={<Percent size={15} />} label={tier ? "Your seller fee" : "Seller fee"}>
              {rate}
            </StatTile>
            <StatTile icon={<BadgeCheck size={15} />} label="Seller tier">
              <Link href="/tiers" className="flex items-center gap-1.5 hover:underline">
                {tierIcon ? (
                  <Image src={tierIcon} alt="" width={22} height={22} unoptimized />
                ) : (
                  <ShieldCheck size={18} className="text-brand-gold-light" />
                )}
                <span className="truncate text-sm">{tierLabel.replace(/ Seller$/, "")}</span>
              </Link>
            </StatTile>
            <StatTile icon={<Truck size={15} />} label="Tracked shipping">
              On every order
            </StatTile>
          </dl>
        </div>

        {/* ── Right: live auctions, or the fee math when there are none ── */}
        {featuredAuctions.length > 0 ? (
          <div className="mx-auto hidden w-full max-w-md rounded-[2rem] bg-white/[0.04] px-6 pb-5 pt-4 ring-1 ring-white/10 backdrop-blur-sm lg:block">
            <p className="mb-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-gold-light">
              <Flame size={13} /> Featured Listings
            </p>
            <FeaturedAuctionCards listings={featuredAuctions} />
          </div>
        ) : (
          <FeeCompareCard tier={tier} rate={rate} />
        )}
      </div>
    </section>
  );
}

function StatTile({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-white/10 backdrop-blur">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium text-white/50">
        <span className="text-brand-gold-light">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5 text-lg font-bold text-brand-gold-light">{children}</dd>
    </div>
  );
}

// What a seller keeps on a $100 sale here vs. on eBay, from the viewer's own
// tier rate — real arithmetic, not a mock listing.
function FeeCompareCard({ tier, rate }: { tier: Listing["sellerTier"] | null; rate: string }) {
  const pct = Number.parseFloat(rate);
  const ourPct = Number.isFinite(pct) ? pct : BEST_PUBLISHED_PCT;
  const ourFee = Math.round((EXAMPLE_SALE_CENTS * ourPct) / 100) + 30;
  const ebayFee = Math.round((EXAMPLE_SALE_CENTS * EBAY_FEE_PCT) / 100);
  const saved = ebayFee - ourFee;
  const maxFee = Math.max(ourFee, ebayFee);

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div aria-hidden className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-brand-gold/30 to-sky-400/10 blur-2xl" />
      <div className="relative rounded-3xl bg-white/[0.07] p-6 ring-1 ring-white/15 backdrop-blur-md">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-gold-light">
          <Gavel size={13} /> Sell a {formatPrice(EXAMPLE_SALE_CENTS)} card
        </p>

        <div className="mt-5 space-y-4">
          <FeeBar
            label="AuctionHous"
            sub={`${Number.isFinite(pct) ? rate : `${BEST_PUBLISHED_PCT}%`} + $0.30${tier ? ` · ${formatSellerTier(tier)}` : ""}`}
            fee={ourFee}
            width={(ourFee / maxFee) * 100}
            highlight
          />
          <FeeBar label="Other providers" sub={`${EBAY_FEE_PCT}%`} fee={ebayFee} width={(ebayFee / maxFee) * 100} />
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl bg-brand-gold/15 px-4 py-3 ring-1 ring-brand-gold/30">
          <span className="flex items-center gap-2 text-sm text-white/80">
            <TrendingDown size={16} className="text-brand-gold-light" /> You keep
          </span>
          <span className="text-2xl font-extrabold text-brand-gold-light">+{formatPrice(saved)}</span>
        </div>
        <p className="mt-3 text-center text-[11px] text-white/40">
          Fees on a {formatPrice(EXAMPLE_SALE_CENTS)} sale. Payouts go to your own Stripe account.
        </p>
      </div>
    </div>
  );
}

function FeeBar({
  label,
  sub,
  fee,
  width,
  highlight = false,
}: {
  label: string;
  sub: string;
  fee: number;
  width: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-semibold ${highlight ? "text-white" : "text-white/60"}`}>
          {label} <span className="text-xs font-normal text-white/40">{sub}</span>
        </span>
        <span className={`text-sm font-bold ${highlight ? "text-brand-gold-light" : "text-white/60"}`}>
          −{formatPrice(fee)}
        </span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${highlight ? "bg-gradient-to-r from-brand-gold to-brand-gold-light" : "bg-white/30"}`}
          style={{ width: `${Math.max(4, width)}%` }}
        />
      </div>
    </div>
  );
}
