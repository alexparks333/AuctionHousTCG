import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, Settings, ShieldCheck, Store, Tag } from "lucide-react";
import Avatar from "@/components/Avatar";
import StarRating from "@/components/StarRating";
import MessageSellerButton from "@/components/messages/MessageSellerButton";
import { formatSellerTier, sellerTierIconSrc } from "@/lib/types";
import type { BuyerStats, PublicUser, ReviewSummary, SellerTier } from "@/lib/api";

// Tier badge colors for a white background (sellerTierAccentColorClass is
// tuned for the dark hero instead).
const TIER_BADGE: Record<SellerTier, string> = {
  new: "bg-gray-100 text-gray-700 ring-gray-200",
  bronze: "bg-orange-50 text-[#9a5a1c] ring-orange-200",
  silver: "bg-slate-100 text-slate-700 ring-slate-200",
  gold: "bg-amber-50 text-brand-gold ring-amber-200",
  platinum: "bg-slate-50 text-slate-700 ring-slate-300",
  hous_trust: "bg-sky-50 text-sky-800 ring-sky-200",
};

// The top of a seller's profile page: a cover band, who they are, their
// standing as a seller and as a buyer, a few at-a-glance numbers, their bio,
// and a way to message them. Fixed on purpose — profiles used to be
// customizable canvases; every profile now reads the same way: this header,
// their listings, then their Singles Shop.
export default function ProfileHeader({
  profile,
  joinedAt,
  reviewSummary,
  buyerStats,
  listingCount,
  singlesCount,
  isOwner,
  isLoggedIn,
}: {
  profile: PublicUser;
  joinedAt: string;
  reviewSummary: ReviewSummary;
  buyerStats: BuyerStats;
  listingCount: number;
  // Distinct cards in stock in their Singles Shop.
  singlesCount: number;
  isOwner: boolean;
  isLoggedIn: boolean;
}) {
  const name = profile.username ?? "Seller";
  const tierIcon = sellerTierIconSrc(profile.tier);

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border bg-white shadow-sm">
      {/* Cover band */}
      <div className="relative h-24 overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 sm:h-28">
        <div aria-hidden className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-gold/25 blur-3xl" />
        <div aria-hidden className="absolute -bottom-24 left-1/4 h-56 w-96 rounded-full bg-sky-400/10 blur-3xl" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "18px 18px",
          }}
        />
        {/* Seller badges (e.g. "1,000 Completed Sales") will live here,
            filling from the right. None exist yet — these are empty slots
            marking the spot. */}
        <ul
          aria-label="Seller badges"
          className="absolute right-5 top-1/2 flex -translate-y-1/2 flex-row-reverse gap-3 sm:right-8"
        >
          {Array.from({ length: 3 }, (_, i) => (
            <li
              key={i}
              aria-hidden
              className="h-12 w-12 rounded-xl border border-dashed border-white/20 bg-white/[0.04] sm:h-16 sm:w-16"
            />
          ))}
        </ul>
      </div>

      <div className="px-5 pb-6 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-4">
            <span className="relative z-10 -mt-12 rounded-full bg-white p-1 shadow-md sm:-mt-14">
              <Avatar label={name} size={104} />
            </span>
            <div className="pt-3">
              <h1 className="text-2xl font-bold leading-tight tracking-tight text-gray-900 sm:text-3xl">{name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Link
                  href="/tiers"
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 transition-opacity hover:opacity-80 ${TIER_BADGE[profile.tier] ?? TIER_BADGE.new}`}
                >
                  {tierIcon ? (
                    <Image src={tierIcon} alt="" width={16} height={16} unoptimized />
                  ) : (
                    <ShieldCheck size={13} />
                  )}
                  {formatSellerTier(profile.tier)}
                </Link>
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <CalendarDays size={13} /> Member since {joinedAt}
                </span>
              </div>
            </div>
          </div>

          {isOwner ? (
            <Link
              href="/account/settings"
              className="flex items-center gap-1.5 rounded-full border border-brand-border px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-brand-navy hover:text-brand-navy"
            >
              <Settings size={15} /> Account Settings
            </Link>
          ) : (
            isLoggedIn && (
              <div className="w-full sm:w-auto">
                <MessageSellerButton recipientId={profile.id} recipientLabel={name} />
              </div>
            )
          )}
        </div>

        {profile.bio && (
          <p className="mt-5 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{profile.bio}</p>
        )}

        {/* At a glance */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <RatingTile
            label="Seller rating"
            rating={reviewSummary.averageRating}
            count={reviewSummary.count}
            empty="No reviews yet"
            href="#reviews"
            linkLabel="Read reviews"
          />
          <RatingTile
            label="Buyer rating"
            rating={buyerStats.averageRating}
            count={buyerStats.reviewCount}
            empty="No buyer reviews yet"
            href="#buyer-reviews"
            linkLabel="Read reviews"
          />
          <CountTile
            icon={<Tag size={16} />}
            label="Listings"
            value={listingCount}
            note="for sale"
            href={listingCount > 0 ? "#listings" : undefined}
          />
          <CountTile
            icon={<Store size={16} />}
            label="Singles Shop"
            value={singlesCount}
            note={singlesCount === 1 ? "card in stock" : "cards in stock"}
            href={singlesCount > 0 ? "#singles" : undefined}
          />
        </div>

        {/* Detailed seller ratings, once there are any */}
        {reviewSummary.count > 0 && (
          <div className="mt-3 grid gap-3 rounded-xl bg-brand-surface px-4 py-3 sm:grid-cols-3">
            <Meter label="Condition accuracy" value={reviewSummary.averageConditionAccuracy} />
            <Meter label="Shipping speed" value={reviewSummary.averageShippingSpeed} />
            <Meter label="Trustworthiness" value={reviewSummary.averageTrustworthiness} />
          </div>
        )}
      </div>
    </section>
  );
}

function RatingTile({
  label,
  rating,
  count,
  empty,
  href,
  linkLabel,
}: {
  label: string;
  rating: number;
  count: number;
  empty: string;
  // Jumps to the written reviews further down the page.
  href?: string;
  linkLabel?: string;
}) {
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper
      href={href}
      className={`group rounded-xl border border-brand-border p-4 ${href ? "transition-colors hover:border-brand-gold/60 hover:bg-amber-50/30" : ""}`}
    >
      <p className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
        {href && linkLabel && (
          <span className="normal-case tracking-normal text-brand-navy opacity-0 transition-opacity group-hover:opacity-100">
            {linkLabel} ↓
          </span>
        )}
      </p>
      <div className="mt-1">
        {count > 0 ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900">{rating.toFixed(1)}</span>
              <StarRating rating={rating} size={14} />
            </div>
            <p className="text-xs text-gray-500">
              {count} review{count === 1 ? "" : "s"}
            </p>
          </>
        ) : (
          <>
            <StarRating rating={0} size={14} />
            <p className="mt-1 text-xs text-gray-500">{empty}</p>
          </>
        )}
      </div>
    </Wrapper>
  );
}

function CountTile({
  icon,
  label,
  value,
  note,
  href,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  note: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <span className="text-brand-gold">{icon}</span>
        {label}
      </p>
      <div className="mt-1">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        <p className="text-xs text-gray-500">{note}</p>
      </div>
    </>
  );
  return href ? (
    <a href={href} className="rounded-xl border border-brand-border p-4 transition-colors hover:border-brand-gold/60 hover:bg-amber-50/30">
      {body}
    </a>
  ) : (
    <div className="rounded-xl border border-brand-border p-4">{body}</div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-gray-600">{label}</span>
        <span className="font-bold text-gray-900">{value.toFixed(1)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div className="h-full rounded-full bg-brand-gold" style={{ width: `${Math.min(100, (value / 5) * 100)}%` }} />
      </div>
    </div>
  );
}
