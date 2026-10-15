import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShoppingBag,
  Star,
  Tag,
  TrendingUp,
  Trophy,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import ListingImage from "@/components/ListingImage";
import type { AppNotification } from "@/lib/api";

// Shared by the header bell's preview popup (NotificationBell) and the full
// /account/notifications page (NotificationsFeed).

// Each kind gets an icon in a colored circle overlapping the listing's own
// photo (what happened, on the actual card) plus a tinted label on the
// meta line — same Won/Sold/Lost language as CelebrationToast and the
// Buying/Selling badges.
type KindMeta = {
  label: string;
  Icon: LucideIcon;
  // Solid circle behind the icon.
  solid: string;
  // Tinted label pill.
  tint: string;
  text: (title: string) => string;
};

const GREEN = { solid: "bg-brand-success", tint: "bg-emerald-50 text-emerald-700" };
const RED = { solid: "bg-brand-urgent", tint: "bg-red-50 text-red-700" };
const GOLD = { solid: "bg-brand-gold", tint: "bg-amber-50 text-amber-700" };
const BLUE = { solid: "bg-sky-500", tint: "bg-sky-50 text-sky-700" };
const GRAY = { solid: "bg-gray-400", tint: "bg-gray-100 text-gray-600" };
const NAVY = { solid: "bg-brand-navy", tint: "bg-slate-100 text-slate-700" };

export const KIND_META: Record<AppNotification["kind"], KindMeta> = {
  won: { ...GREEN, label: "Won", Icon: Trophy, text: (t) => `You won ${t}!` },
  bought: { ...GREEN, label: "Bought", Icon: ShoppingBag, text: (t) => `You bought ${t}!` },
  sold: { ...GREEN, label: "Sold", Icon: DollarSign, text: (t) => `Your listing sold: ${t}` },
  outbid: { ...RED, label: "Outbid", Icon: TrendingUp, text: (t) => `You've been outbid on ${t}` },
  seller_review: { ...GOLD, label: "Review", Icon: Star, text: (t) => `You got a new review on ${t}` },
  buyer_review: { ...GOLD, label: "Review", Icon: Star, text: (t) => `The seller left you a review on ${t}` },
  offer_received: { ...BLUE, label: "Offer", Icon: Tag, text: (t) => `New offer on ${t}` },
  offer_accepted: { ...GREEN, label: "Accepted", Icon: CheckCircle2, text: (t) => `Your offer on ${t} was accepted!` },
  offer_declined: { ...GRAY, label: "Declined", Icon: XCircle, text: (t) => `Your offer on ${t} was declined` },
  second_chance_offer: {
    ...GOLD,
    label: "2nd Chance",
    Icon: RotateCcw,
    text: (t) => `You're the runner-up on ${t} — it can be yours`,
  },
  listing_needs_relist: {
    ...GRAY,
    label: "Relist",
    Icon: RefreshCw,
    text: (t) => `${t} didn't sell — relist it to try again`,
  },
  chargeback_lost: {
    ...RED,
    label: "Chargeback",
    Icon: AlertTriangle,
    text: (t) => `A chargeback was lost on ${t} — you won't be paid for this one`,
  },
  ship_deadline_warning: {
    ...GOLD,
    label: "Warning",
    Icon: Clock,
    text: (t) => `You missed the ship-by deadline on ${t}`,
  },
  account_suspended: {
    ...RED,
    label: "Suspended",
    Icon: ShieldAlert,
    text: () => `Your account is temporarily suspended — a second missed shipping deadline within 30 days`,
  },
  ship_extension_granted: {
    ...NAVY,
    label: "Extension",
    Icon: CalendarClock,
    text: (t) => `The seller of ${t} requested more time to ship — you were compensated`,
  },
  account_banned: {
    ...RED,
    label: "Banned",
    Icon: Ban,
    text: () =>
      `Your account has been permanently banned for reversing a completed sale through a chargeback instead of filing a claim`,
  },
};

// Where clicking a notification actually goes. won/bought/sold go to
// /order/{listingId} — app/order/[id]/page.tsx is keyed by LISTING id, not
// a real orders.id (it calls getListing(id)/getOrderForListing(id, ...)),
// and degrades gracefully to its own "shipping isn't wired up yet" copy
// when no real order row exists yet for that listing — so this is safe to
// route to unconditionally for these three kinds, no join against orders
// needed. An offer_received always belongs to the listing's own seller,
// so it goes straight to that listing's own Offers panel (only rendered
// for the seller, highlighting this one offer among however many others
// are pending there); offer_accepted/declined always belong to the buyer
// who sent it, so those go to the buyer's own sent-offers list instead;
// everything else (outbid: still just an active auction; the review
// kinds: no order/offer concept fits any better) goes to the plain
// listing page.
export function notificationHref(n: AppNotification): string {
  if (n.kind === "won" || n.kind === "bought" || n.kind === "sold") return `/order/${n.listingId}`;
  if (n.kind === "offer_received" && n.offerId) return `/listing/${n.listingId}?offer=${n.offerId}`;
  if ((n.kind === "offer_accepted" || n.kind === "offer_declined") && n.offerId) {
    return `/account/bids-offers?offer=${n.offerId}`;
  }
  if (n.kind === "second_chance_offer" && n.secondChanceOfferId) {
    return `/second-chance/${n.secondChanceOfferId}`;
  }
  if (n.kind === "chargeback_lost" || n.kind === "ship_extension_granted") return `/order/${n.listingId}`;
  return `/listing/${n.listingId}`;
}

// The listing's photo with the kind's icon circle on its corner. The
// circle sits outside the clipping box so it can overlap the corner.
export function NotificationThumb({
  n,
  size = "md",
  eager = false,
}: {
  n: AppNotification;
  size?: "sm" | "md";
  // Load even while hidden — NotificationBell warms its popup's thumbnails.
  eager?: boolean;
}) {
  const meta = KIND_META[n.kind];
  const small = size === "sm";
  return (
    <span className={`relative aspect-[5/7] shrink-0 ${small ? "w-8" : "w-11"}`}>
      <span className="block h-full w-full overflow-hidden rounded-md shadow-sm ring-1 ring-black/5">
        <ListingImage
          src={n.listingImageUrl}
          game={n.listingGame}
          label={n.listingTitle}
          sizes={small ? "32px" : "48px"}
          loading={eager ? "eager" : undefined}
        />
      </span>
      <span
        className={`absolute flex items-center justify-center rounded-full text-white shadow ring-2 ring-white ${meta.solid} ${
          small ? "-bottom-1 -right-1 h-4 w-4" : "-bottom-1.5 -right-1.5 h-6 w-6"
        }`}
      >
        <meta.Icon size={small ? 9 : 12} strokeWidth={2.75} />
      </span>
    </span>
  );
}

// "Today" / "Yesterday" / "This week" / "Earlier" sections, in order. Only
// call this client-side (local dates differ from the server's).
export function groupByDay(items: AppNotification[]): { label: string; items: AppNotification[] }[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const labelFor = (iso: string) => {
    const t = new Date(iso).getTime();
    if (t >= startOfToday.getTime()) return "Today";
    if (t >= startOfToday.getTime() - day) return "Yesterday";
    if (t >= startOfToday.getTime() - 6 * day) return "This week";
    return "Earlier";
  };
  const groups: { label: string; items: AppNotification[] }[] = [];
  for (const n of items) {
    const label = labelFor(n.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return groups;
}
