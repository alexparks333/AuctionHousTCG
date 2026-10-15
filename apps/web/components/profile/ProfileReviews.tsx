"use client";

import { useEffect, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import Avatar from "@/components/Avatar";
import ReviewsList from "@/components/ReviewsList";
import StarRating from "@/components/StarRating";
import type { BuyerReviewTag, BuyerStats, ReviewSummary } from "@/lib/api";

// Written reviews shown before "Show all".
const PREVIEW_COUNT = 5;

type Tab = "seller" | "buyer";

// The bottom of a seller's profile, with a toggle between two kinds of
// reviews: Seller Reviews (buyers rating what it was like to buy from this
// person) and Buyer Reviews (sellers rating this person as a buyer).
// Every rating counts toward the summary on the left; only reviews with
// text are listed on the right (product decision — a bare star rating has
// nothing to read). Each written review shows its date so a burst of
// look-alike reviews on one day stands out.
//
// The header's rating tiles link to #reviews (Seller) and #buyer-reviews
// (Buyer); the hash picks the tab. Writing a review happens elsewhere —
// this is read-only except for the owner's reply form inside ReviewsList.
export default function ProfileReviews({
  summary,
  buyerStats,
  username,
  isOwner,
}: {
  summary: ReviewSummary;
  buyerStats: BuyerStats;
  username: string;
  isOwner: boolean;
}) {
  const [tab, setTab] = useState<Tab>("seller");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    function fromHash() {
      if (window.location.hash === "#buyer-reviews") setTab("buyer");
      else if (window.location.hash === "#reviews") setTab("seller");
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  function switchTab(next: Tab) {
    setTab(next);
    setShowAll(false);
  }

  const sellerRatings = (summary.reviews ?? []).map((r) => r.overallRating);
  const buyerReviews = buyerStats.reviews ?? [];
  const buyerRatings = buyerReviews.map((r) => r.rating);

  const sellerWritten = (summary.reviews ?? []).filter((r) => r.comment?.trim());
  const buyerWritten = buyerReviews.filter((r) => r.comment?.trim());

  const isSeller = tab === "seller";
  const ratings = isSeller ? sellerRatings : buyerRatings;
  const average = isSeller ? summary.averageRating : buyerStats.averageRating;
  const writtenCount = isSeller ? sellerWritten.length : buyerWritten.length;
  const who = isSeller ? "buyers" : "sellers";

  return (
    <section
      id="reviews"
      className="relative scroll-mt-32 rounded-2xl border border-brand-border bg-white p-5 shadow-sm sm:p-7"
    >
      {/* Scroll target for the header's "Buyer rating" tile. */}
      <span id="buyer-reviews" aria-hidden className="absolute top-0 scroll-mt-32" />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-navy text-brand-gold-light">
            <MessageSquareText size={19} />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-gray-900">
              {isSeller ? "Seller Reviews" : "Buyer Reviews"}
            </h2>
            <p className="text-sm text-gray-500">
              {ratings.length > 0
                ? `${ratings.length} ${ratings.length === 1 ? "rating" : "ratings"} · ${writtenCount} written ${writtenCount === 1 ? "review" : "reviews"} from ${who}`
                : isSeller
                  ? `No buyer has reviewed ${username} as a seller yet`
                  : `No seller has reviewed ${username} as a buyer yet`}
            </p>
          </div>
        </div>

        <div role="tablist" aria-label="Review type" className="flex rounded-full bg-brand-surface p-1 text-sm font-semibold">
          {(
            [
              ["seller", "Seller Reviews", sellerRatings.length],
              ["buyer", "Buyer Reviews", buyerRatings.length],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => switchTab(value)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-colors ${
                tab === value ? "bg-brand-navy text-white shadow-sm" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 text-[11px] ${tab === value ? "bg-white/20 text-white" : "bg-white text-gray-500"}`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {ratings.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-brand-surface/60 px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm">
            <Star size={20} />
          </span>
          <p className="mt-3 font-semibold text-gray-900">No reviews yet</p>
          <p className="mt-1 text-sm text-gray-500">
            {isSeller
              ? "Reviews from buyers will show up here after their orders arrive."
              : "Reviews from sellers this person bought from will show up here."}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_1fr]">
          <RatingSummary average={average} ratings={ratings} />

          <div className="min-w-0">
            {writtenCount === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center">
                <p className="font-semibold text-gray-900">No written reviews yet</p>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  {ratings.length === 1 ? `1 ${who.slice(0, -1)} has` : `${ratings.length} ${who} have`} rated {username}{" "}
                  without leaving a comment — their stars count toward the score on the left.
                </p>
              </div>
            ) : isSeller ? (
              <div className="-mt-4">
                <ReviewsList
                  reviews={showAll ? sellerWritten : sellerWritten.slice(0, PREVIEW_COUNT)}
                  username={username}
                  isOwner={isOwner}
                />
              </div>
            ) : (
              <ul className="flex flex-col gap-4">
                {(showAll ? buyerWritten : buyerWritten.slice(0, PREVIEW_COUNT)).map((r) => (
                  <li key={r.id} className="rounded-xl border border-brand-border bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Avatar label={r.reviewerUsername ?? "Seller"} size={28} />
                        <span className="text-sm font-semibold text-gray-900">{r.reviewerUsername ?? "A seller"}</span>
                        <TagChip tag={r.tag} />
                      </div>
                      <StarRating rating={r.rating} size={14} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      <time dateTime={r.createdAt} className="font-medium text-gray-700">
                        Written {formatReviewDate(r.createdAt)}
                      </time>
                      {r.listingTitle && <> · Sold them: {r.listingTitle}</>}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{r.comment}</p>
                  </li>
                ))}
              </ul>
            )}
            {writtenCount > PREVIEW_COUNT && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="rounded-full border border-brand-border px-5 py-2 text-sm font-semibold text-brand-navy transition-colors hover:border-brand-navy"
                >
                  {showAll ? "Show fewer reviews" : `Show all ${writtenCount} written reviews`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function RatingSummary({ average, ratings }: { average: number; ratings: number[] }) {
  // How many ratings landed on each star count, for the breakdown bars.
  const byStars = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: ratings.filter((r) => Math.round(r) === stars).length,
  }));
  return (
    <div className="h-fit rounded-xl bg-brand-surface p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold text-gray-900">{average.toFixed(1)}</span>
        <span className="text-sm text-gray-500">out of 5</span>
      </div>
      <StarRating rating={average} size={18} />
      <p className="mt-1 text-xs text-gray-500">
        Based on {ratings.length} rating{ratings.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-4 flex flex-col gap-1.5">
        {byStars.map(({ stars, count }) => (
          <li key={stars} className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 font-medium text-gray-600">{stars} ★</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
              <span
                className="block h-full rounded-full bg-brand-gold"
                style={{ width: `${ratings.length ? (count / ratings.length) * 100 : 0}%` }}
              />
            </span>
            <span className="w-6 shrink-0 text-right text-gray-500">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TAG_STYLE: Record<BuyerReviewTag, { label: string; className: string }> = {
  trustworthy: { label: "Trustworthy", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  suspicious: { label: "Suspicious", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  aggressive: { label: "Aggressive", className: "bg-red-50 text-red-700 ring-red-200" },
};

function TagChip({ tag }: { tag: BuyerReviewTag }) {
  const style = TAG_STYLE[tag];
  if (!style) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${style.className}`}>{style.label}</span>
  );
}

function formatReviewDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
