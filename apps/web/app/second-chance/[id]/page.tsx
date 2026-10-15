import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SecondChanceActions from "@/components/SecondChanceActions";
import { ApiError, getSecondChanceOfferServer } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import { formatPrice } from "@/lib/types";

// eBay's "Second Chance Offer" landing page — reached from the bell
// notification a runner-up bidder gets when a won auction's sale falls
// through for a buyer-fault reason (never paid, or a pre-ship chargeback).
// Only the offer's own bidder can view/act on it; the seller can view it
// too (read-only) since it's their sale.
export default async function SecondChancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const local = await getLocalSession();
  if (!local) redirect("/login");

  let offer;
  try {
    offer = await getSecondChanceOfferServer(id, local.accessToken);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  const isBidder = offer.bidderId === local.userId;
  const isSeller = offer.sellerId === local.userId;
  if (!isBidder && !isSeller) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 py-12">
        <h1 className="text-2xl font-bold text-gray-900">Second Chance Offer</h1>
        <p className="mt-2 text-sm text-gray-600">
          {isBidder
            ? "The original buyer on this auction never completed the purchase. As the next-highest bidder, you can buy it now at your own last max bid."
            : "This is the second-chance offer sent to the runner-up bidder on your sale."}
        </p>

        <div className="mt-6 rounded-2xl border border-brand-border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            {offer.listingImageUrl ? (
              <Image
                src={offer.listingImageUrl}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-lg bg-gradient-to-br from-brand-navy/20 to-brand-gold/20" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-900">{offer.listingTitle}</p>
              <p className="text-sm text-gray-500">Sold by {offer.sellerUsername ?? "the seller"}</p>
            </div>
          </div>

          <div className="mt-4 flex items-baseline justify-between border-t border-brand-border pt-4">
            <span className="text-sm text-gray-500">Your price</span>
            <span className="text-xl font-bold text-gray-900">{formatPrice(offer.amountCents)}</span>
          </div>

          {isBidder && (
            <SecondChanceActions offer={offer} />
          )}
          {!isBidder && (
            <p className="mt-4 rounded-lg bg-brand-surface px-3 py-2 text-xs text-gray-500">
              Status: <span className="font-medium capitalize">{offer.status}</span>
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
