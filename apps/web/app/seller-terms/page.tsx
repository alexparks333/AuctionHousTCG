import Link from "next/link";
import LegalPage, { type LegalSection } from "@/components/legal/LegalPage";
import { SELLER_AGREEMENT_EFFECTIVE_DATE } from "@/lib/agreements";

export const metadata = {
  title: "Seller Agreement | AuctionHous - TCG",
};

const SUPPORT_EMAIL = "support@auctionhous.net";

// Numbers mirror docs/PercentageModel.md and apps/api (internal/seller tier
// rates, order.ShipWindowHours, the ship-strike timers in cmd/worker, the
// claim window in order/fulfillment.go, the payout flow in internal/payout).
// Change the code and this page together, and bump SELLER_AGREEMENT_VERSION
// (lib/agreements.ts + internal/agreement) for any material change.
const TIER_LADDER = [
  { name: "New", rate: "7.00%", requirement: "0–14 completed orders" },
  { name: "Bronze", rate: "6.50%", requirement: "15–49 completed orders" },
  { name: "Silver", rate: "6.25%", requirement: "50–149 completed orders" },
  { name: "Gold", rate: "6.00%", requirement: "150–499 completed orders" },
  { name: "Platinum", rate: "5.50%", requirement: "500+ completed orders" },
  { name: "Hous Trust", rate: "Custom", requirement: "Platinum + application, by invitation" },
];

const LIABILITY = [
  { scenario: "Item wasn't as described", responsible: "Seller" },
  { scenario: "Buyer says it never arrived, and there's no tracking", responsible: "Seller" },
  {
    scenario: "Buyer says it never arrived, tracking shows delivered, order under $50",
    responsible: "AuctionHous (absorbed, not disputed)",
  },
  { scenario: "Same, but the order is $50 or more", responsible: "Buyer, after a fraud review" },
  { scenario: "Payment fraud or a stolen card", responsible: "AuctionHous" },
  { scenario: "Buyer changed their mind", responsible: "Buyer — not covered" },
  {
    scenario: "Damaged in transit, and the seller has photos showing adequate packing",
    responsible: "AuctionHous, up to $100",
  },
];

function Term({ label }: { label: string }) {
  return <strong>{label}:</strong>;
}

function Table({ head, rows }: { head: [string, string, string?]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-brand-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-surface text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {head.filter(Boolean).map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border bg-white">
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((cell, i) => (
                <td key={i} className={`px-4 py-2 ${i === 0 ? "font-medium text-gray-900" : "text-gray-600"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About this agreement",
    body: (
      <p>
        This Seller Agreement adds to our <Link href="/terms">Terms of Service</Link> and applies whenever you list
        an item or stock your Singles Shop. You accept it before you sell for the first time. If it conflicts with
        the Terms on a selling matter, this agreement wins.
      </p>
    ),
  },
  {
    id: "setup",
    title: "Getting set up",
    body: (
      <ul>
        <li>
          To get paid, you set up a seller account with our payment processor, Stripe, and agree to the{" "}
          <a href="https://stripe.com/legal/connect-account" target="_blank" rel="noreferrer">
            Stripe Connected Account Agreement
          </a>
          . Stripe verifies your identity and collects the tax and bank details it needs.
        </li>
        <li>Your details must be accurate and kept up to date, including your return address.</li>
        <li>We may require extra verification, or limit selling, while we or Stripe review your account.</li>
      </ul>
    ),
  },
  {
    id: "payments",
    title: "How you get paid",
    body: (
      <>
        <p>
          <Term label="We collect payment for you" />{" "}You appoint AuctionHous as your limited agent to receive
          payments from buyers on your behalf. When a buyer&apos;s payment to AuctionHous succeeds, the buyer has
          paid you, and the buyer&apos;s obligation to you is complete. We then owe you the sale amount under this
          agreement.
        </p>
        <p>
          <Term label="When it's released" />{" "}We hold the payment with Stripe while you ship and through the
          buyer&apos;s claim window: 3 days after delivery, or 7 days for orders of $250 or more. Some higher-tier
          sellers&apos; orders are released as soon as they&apos;re delivered. Once an order completes, we transfer
          the sale amount — minus our fee and any shipping label you bought through us — to your Stripe account.
        </p>
        <p>
          <Term label="Withdrawing" />{" "}You choose when to move your balance to your bank from the{" "}
          <Link href="/account/withdraw">Withdraw</Link> page: a standard transfer (free, about 1–2 business days)
          or an instant transfer (2% fee, usually within about 30 minutes). Your very first payout may be held
          briefly while Stripe finishes verifying your account.
        </p>
        <p>
          <Term label="Refunds and holds" />{" "}If a buyer&apos;s claim is decided in their favor before release,
          the held payment is refunded instead. We may hold or deduct amounts you owe — refunds, chargebacks you
          are responsible for, fees, or label costs — from current or future sales. Held payments don&apos;t earn
          interest.
        </p>
      </>
    ),
  },
  {
    id: "fees",
    title: "Fees and seller tiers",
    body: (
      <>
        <p>
          Each completed sale is charged <strong>$0.30</strong> plus a percentage of the item price and shipping
          (never sales tax), set by your seller tier. There&apos;s no listing fee.
        </p>
        <Table
          head={["Tier", "Rate", "Reached at"]}
          rows={TIER_LADDER.map((t) => [
            t.name,
            t.rate === "Custom" ? "Negotiated" : `${t.rate} + $0.30`,
            t.requirement,
          ])}
        />
        <p>
          Your tier is worked out automatically from your completed orders, reviews and dispute rate — see the{" "}
          <Link href="/tiers">fees page</Link>. Cancelled and refunded orders never count toward promotion. A dispute
          rate above 4% over the last 90 days drops you one tier, with a 30-day wait before you can move back up.
          If a buyer pays by bank and gets a discount, that comes out of our fee, never your proceeds.
        </p>
      </>
    ),
  },
  {
    id: "listings",
    title: "Listing standards",
    body: (
      <ul>
        <li>Only list items you own and have in hand, ready to ship.</li>
        <li>
          Condition and grade must be accurate. Describe the flaws you can see, not just the ones you think matter
          — condition is the most common reason for claims.
        </li>
        <li>Photos must be of the actual card or slab you&apos;re selling, not a stock image or another copy.</li>
        <li>
          For a graded slab, the grading company, grade and cert number must match the slab exactly. We may remove
          a listing whose cert number doesn&apos;t check out.
        </li>
        <li>Game, set, card number and condition must be filled in accurately.</li>
      </ul>
    ),
  },
  {
    id: "singles",
    title: "Your Singles Shop",
    body: (
      <ul>
        <li>
          Singles Shop prices are set by AuctionHous from market prices, so every copy of a card in the same
          condition and finish costs the same in every shop. You set the quantity only.
        </li>
        <li>Only Commons, Uncommons and Rares in Near Mint, Lightly Played or Moderately Played condition can be stocked.</li>
        <li>
          Keep your stock accurate. Singles a buyer adds to an order ship together with that order, under the same
          deadlines.
        </li>
      </ul>
    ),
  },
  {
    id: "shipping",
    title: "Shipping",
    body: (
      <ul>
        <li>
          <Term label="Ship within 96 hours" />{" "}Ship every order with tracking within 96 hours of payment. You can
          request one extension. An order that isn&apos;t shipped in time is cancelled and refunded automatically.
        </li>
        <li>
          <Term label="Missed deadlines" />{" "}A second missed ship deadline within 30 days suspends your selling for
          7 days.
        </li>
        <li>
          <Term label="Labels" />{" "}Labels bought through AuctionHous are tracked, and their cost is deducted from
          the sale. Tracked envelope labels can&apos;t be refunded once bought, so check your return address first.
        </li>
        <li>
          <Term label="Free shipping and bundles" />{" "}If you offer free shipping, you pay the label. If a buyer adds
          enough singles that the order needs a package instead of an envelope, the buyer pays the package rate.
        </li>
        <li>Pack cards so they arrive in the condition you described — sleeved, and protected against bending.</li>
      </ul>
    ),
  },
  {
    id: "disputes",
    title: "Claims, and who's responsible",
    body: (
      <>
        <p>
          We don&apos;t offer unconditional buyer protection — at our fee levels it can&apos;t be funded — so
          responsibility is assigned plainly:
        </p>
        <Table head={["What happened", "Who's responsible"]} rows={LIABILITY.map((r) => [r.scenario, r.responsible])} />
        <p>
          When a buyer opens a claim, you have 48 hours to work it out with them — often with a partial refund
          rather than a return. After that it&apos;s escalated and we decide it, and either side may appeal once.
          Claims affect your tier through your dispute rate whatever the outcome.
        </p>
      </>
    ),
  },
  {
    id: "taxes",
    title: "Taxes",
    body: (
      <p>
        You&apos;re responsible for the income tax on your sales. Where the law requires a marketplace to collect
        sales tax, we&apos;ll collect it from buyers at checkout. Stripe may send you, and the IRS, a Form 1099-K for
        your sales when you meet the reporting thresholds.
      </p>
    ),
  },
  {
    id: "conduct",
    title: "Prohibited items and conduct",
    body: (
      <>
        <ul>
          <li>Counterfeit cards, counterfeit slabs, or slabs with tampered or resealed holders.</li>
          <li>Listings priced or described to mislead a buyer about condition, grade or authenticity.</li>
          <li>Moving a sale off AuctionHous to avoid fees.</li>
          <li>
            Gaming your order count, reviews or dispute rate — including buying from yourself with other accounts.
          </li>
        </ul>
        <p>
          Breaking these rules can lead to listing removal, a tier drop, or suspension. We&apos;ll tell you the
          specific reason, not a generic notice.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this agreement",
    body: (
      <p>
        We may update this agreement as fees and payout rules change. For a material change — a higher fee, a new
        tier threshold, or a change to who&apos;s responsible in a claim — we&apos;ll ask you to accept the new
        version before your next listing, and it won&apos;t apply to sales already in progress. Questions? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    ),
  },
];

export default function SellerAgreementPage() {
  return (
    <LegalPage
      eyebrow="Legal · For sellers"
      title="Seller Agreement"
      effectiveDate={SELLER_AGREEMENT_EFFECTIVE_DATE}
      intro={
        <p>
          How selling on AuctionHous works: getting paid, fees, shipping deadlines, and what happens when a buyer
          opens a claim.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
