import Link from "next/link";
import { notFound } from "next/navigation";
import { Gavel, Tag, Zap } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AccountBannedBanner from "@/components/AccountBannedBanner";
import ProfileHeader from "@/components/profile/ProfileHeader";
import ProfileReviews from "@/components/profile/ProfileReviews";
import ListingSection from "@/components/ListingSection";
import SinglesShopShowcase from "@/components/singles/SinglesShopShowcase";
import {
  getUserByUsername,
  getActiveListings,
  getSellerReviews,
  getBuyerStats,
  getMyWatchedIds,
  getUserSingles,
} from "@/lib/api";
import { getLocalSession } from "@/lib/session";

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  // getUserByUsername and getLocalSession don't depend on each other, so
  // they run together instead of stacking — this page never displays
  // verified identity, only compares ids (isOwner) and reads the
  // access_token, so the fast local cookie read is enough; no need for
  // getCurrentSession()'s slower getUser() network verification.
  const [profile, local] = await Promise.all([getUserByUsername(username), getLocalSession()]);
  if (!profile) notFound();

  const isOwner = local?.userId === profile.id;

  const [listings, reviewSummary, buyerStats, watchedIds, singles] = await Promise.all([
    getActiveListings({ sellerId: profile.id }),
    getSellerReviews(username),
    getBuyerStats(username),
    local ? getMyWatchedIds(local.accessToken).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    getUserSingles(username),
  ]);

  const name = profile.username ?? username;
  const auctionCount = listings.filter((l) => l.format === "auction").length;
  const fixedCount = listings.length - auctionCount;
  const singlesCardCount = new Set(singles.filter((s) => s.quantity > 0).map((s) => s.catalogCardId)).size;

  const joinedAt = new Date(profile.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      {/* profile.isBanned reflects THIS profile's own ban status, shown to
          any viewer — distinct from Header's own AccountBannedBanner
          above, which only ever reflects the logged-in viewer's own
          account (Plan B / CLAUDE.md §7: a ban must read as a dead account
          to anyone visiting it, not just to the banned user themselves). */}
      {profile.isBanned && <AccountBannedBanner variant="profile" />}

      <div className="flex w-full flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-12 sm:py-8 lg:px-14">
        {/* Header, listings, Singles Shop, then written reviews (product
            decision; the old customizable canvas was removed). */}
        <ProfileHeader
          profile={profile}
          joinedAt={joinedAt}
          reviewSummary={reviewSummary}
          buyerStats={buyerStats}
          listingCount={listings.length}
          singlesCount={singlesCardCount}
          isOwner={isOwner}
          isLoggedIn={Boolean(local)}
        />

        <section
          id="listings"
          className="scroll-mt-32 rounded-2xl border border-brand-border bg-white p-5 shadow-sm sm:p-7"
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-navy text-brand-gold-light">
                <Tag size={19} />
              </span>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-gray-900">Listings</h2>
                <p className="text-sm text-gray-500">
                  {listings.length > 0
                    ? `${listings.length} for sale from ${name}`
                    : `${name} has nothing listed right now`}
                </p>
              </div>
            </div>
            {listings.length > 0 && (
              <div className="flex gap-2 text-xs font-semibold">
                {auctionCount > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-brand-surface px-3 py-1.5 text-gray-700">
                    <Gavel size={13} /> {auctionCount} {auctionCount === 1 ? "auction" : "auctions"}
                  </span>
                )}
                {fixedCount > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-brand-surface px-3 py-1.5 text-gray-700">
                    <Zap size={13} /> {fixedCount} Buy It Now
                  </span>
                )}
              </div>
            )}
          </div>

          {listings.length > 0 ? (
            <ListingSection
              title="Listings"
              items={listings}
              watchedIds={watchedIds}
              isLoggedIn={Boolean(local)}
              currentUserId={local?.userId}
              headerless
            />
          ) : (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-brand-surface/60 px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm">
                <Tag size={20} />
              </span>
              <p className="mt-3 font-semibold text-gray-900">No listings right now</p>
              <p className="mt-1 text-sm text-gray-500">
                {isOwner ? "List a card and it'll show up here." : "Check back soon, or browse their Singles Shop below."}
              </p>
              {isOwner && (
                <Link
                  href="/sell"
                  className="mt-4 rounded-full bg-brand-navy px-5 py-2 text-sm font-semibold text-white hover:bg-brand-navy-light"
                >
                  List a card
                </Link>
              )}
            </div>
          )}
        </section>

        <SinglesShopShowcase singles={singles} username={name} isOwner={isOwner} />

        <ProfileReviews
          summary={reviewSummary}
          buyerStats={buyerStats}
          username={name}
          isOwner={isOwner}
        />
      </div>

      <Footer />
    </div>
  );
}
