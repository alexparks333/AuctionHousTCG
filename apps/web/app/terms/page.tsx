import Link from "next/link";
import LegalPage, { type LegalSection } from "@/components/legal/LegalPage";
import { TERMS_EFFECTIVE_DATE } from "@/lib/agreements";

export const metadata = {
  title: "Terms of Service | AuctionHous - TCG",
};

const SUPPORT_EMAIL = "support@auctionhous.net";

// A bold "Label:" lead-in — the space after it is written explicitly at each
// use ({" "}), same as the Privacy Policy.
function Term({ label }: { label: string }) {
  return <strong>{label}:</strong>;
}

// Every deadline and rule quoted here is the one the code actually enforces
// (24h to pay: PAYMENT_WINDOW_MS; 96h to ship: order.ShipWindowHours; 3/7-day
// claim window: order/fulfillment.go; 48h claim negotiation + one appeal:
// internal/dispute). Change the code and this page together, and bump
// TERMS_VERSION in lib/agreements.ts (and apps/api internal/agreement) for any
// material change so every member is asked to accept the new version. Have a
// lawyer review before launch — especially §18 (arbitration).
const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreeing to these terms",
    body: (
      <>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and AuctionHous - TCG
          (&ldquo;AuctionHous,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). They apply whenever you use our website,
          apps or services (the &ldquo;Service&rdquo;). By creating an account or using the Service, you agree to
          these Terms and to our <Link href="/privacy">Privacy Policy</Link>. If you sell, you also agree to our{" "}
          <Link href="/seller-terms">Seller Agreement</Link>.
        </p>
        <p>
          <strong>
            Section 18 requires most disputes between you and AuctionHous to be resolved by individual binding
            arbitration, not in court, and waives class actions. Please read it — it explains how to opt out.
          </strong>
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Who can use AuctionHous",
    body: (
      <ul>
        <li>You must be at least 18 years old and able to enter a binding contract.</li>
        <li>The Service is offered in the United States, and items ship to US addresses only.</li>
        <li>
          You may not use the Service if we&apos;ve suspended or banned you, or if you&apos;re barred from receiving
          services under US law.
        </li>
        <li>If you use the Service for a business, you agree to these Terms on that business&apos;s behalf.</li>
      </ul>
    ),
  },
  {
    id: "marketplace",
    title: "What AuctionHous is",
    body: (
      <>
        <p>
          AuctionHous is a marketplace that lets members buy and sell trading cards with each other. When you buy
          something, your contract of sale is with the seller, not with us. We don&apos;t own, hold or inspect the
          items listed, and we don&apos;t guarantee that a listing is accurate, that an item is authentic or in the
          condition described, or that a buyer or seller will complete a sale.
        </p>
        <p>
          What we do provide is the venue, payment processing through our partner Stripe, shipping labels, and a
          claims process for when something goes wrong (Section 8). Card names, sets and images from our catalog
          are for reference only.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <ul>
        <li>Give us accurate information and keep it up to date, including your shipping address.</li>
        <li>
          Keep your login secure. You&apos;re responsible for everything done through your account. Tell us right
          away at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> if you think someone else has accessed it.
        </li>
        <li>One person, one account. Don&apos;t open accounts to get around a suspension, ban or limit.</li>
        <li>
          We may ask you to verify your phone number, email or identity before you can buy, sell or reach higher
          limits, and we may limit an account while verification is pending.
        </li>
        <li>
          Your username must not impersonate anyone or be offensive. We may change or reclaim a username that
          breaks these Terms.
        </li>
      </ul>
    ),
  },
  {
    id: "buying",
    title: "Buying",
    body: (
      <>
        <ul>
          <li>
            <Term label="Bids are binding" />{" "}A bid is a commitment to buy the item at up to your maximum bid if
            you win. Bids can&apos;t be withdrawn. We bid for you automatically, only as much as needed to keep you in
            the lead, up to your maximum — which is never shown to anyone.
          </li>
          <li>
            <Term label="Auctions end at a fixed time" />{" "}Whoever holds the highest bid when the timer reaches zero
            wins. Auctions aren&apos;t extended by late bids.
          </li>
          <li>
            <Term label="Buy It Now and offers" />{" "}Choosing Buy It Now, or having an offer accepted (including a
            second-chance offer), is a binding agreement to buy at that price.
          </li>
          <li>
            <Term label="Pay on time" />{" "}You must pay for a won auction within 24 hours. If you don&apos;t, the
            sale is cancelled, and repeated non-payment can lead to limits on or suspension of your account.
          </li>
          <li>
            <Term label="Price and checkout" />{" "}The total at checkout includes the item price, shipping, any
            singles you add from the seller&apos;s shop, and any taxes we&apos;re required to collect. Paying by bank
            may include a discount shown at checkout.
          </li>
          <li>
            <Term label="Your address" />{" "}You&apos;re responsible for giving a correct shipping address. If an
            item is lost or delayed because of an address you entered, any cost to fix it is yours.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "selling",
    title: "Selling",
    body: (
      <>
        <p>
          Before you sell, you must accept our <Link href="/seller-terms">Seller Agreement</Link> and set up payouts
          with Stripe. The Seller Agreement has the details on fees, payouts and seller tiers. In short:
        </p>
        <ul>
          <li>
            Only list items you own and have in hand. Describe them honestly, including condition and any grading,
            and use your own photos of the actual item.
          </li>
          <li>
            When an item sells, you must ship it with tracking within 96 hours (you can request one extension).
            Unshipped orders are cancelled and refunded, and missed deadlines can lead to suspension.
          </li>
          <li>
            You pay the seller fee for your tier on each completed sale, as published on our{" "}
            <Link href="/tiers">fees page</Link>. Singles Shop prices are set by AuctionHous, not by sellers.
          </li>
          <li>
            You&apos;re responsible for any taxes on your sales and for complying with the laws that apply to you as
            a seller.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payments",
    body: (
      <>
        <p>
          Payments are processed by Stripe. By paying or selling on AuctionHous, you also agree to Stripe&apos;s
          terms, including the{" "}
          <a href="https://stripe.com/legal/connect-account" target="_blank" rel="noreferrer">
            Stripe Connected Account Agreement
          </a>{" "}
          if you sell.
        </p>
        <p>
          <Term label="How money moves" />{" "}When you buy, you pay AuctionHous through Stripe. Each seller appoints
          AuctionHous as their limited agent to accept payment from buyers on the seller&apos;s behalf, so{" "}
          <strong>once your payment succeeds, you have paid the seller</strong> — even if we haven&apos;t passed the
          money on yet.
        </p>
        <p>
          We hold the payment with Stripe while the order is shipped and through the claim window (Section 8). When
          the order completes, we transfer the sale amount, minus our fee and any shipping label cost, to the
          seller&apos;s Stripe account, and the seller can withdraw it to their bank. If a refund is approved, the
          held payment goes back to the buyer instead. AuctionHous is not a bank: held payments don&apos;t earn
          interest, and you can&apos;t store a balance with us.
        </p>
        <p>
          If a payment is disputed or reversed (a chargeback), we may share order and shipping information with
          Stripe and the card issuer to respond to it.
        </p>
      </>
    ),
  },
  {
    id: "claims",
    title: "Shipping, claims and refunds",
    body: (
      <>
        <ul>
          <li>
            <Term label="Claim window" />{" "}After an order is delivered, the buyer has 3 days (7 days for orders of
            $250 or more) to open a claim if the item didn&apos;t arrive, isn&apos;t as described, or was damaged in
            transit. After that, the sale is final. Some higher-tier sellers&apos; orders complete as soon as
            they&apos;re delivered.
          </li>
          <li>
            <Term label="How claims work" />{" "}The buyer and seller first have 48 hours to work it out. If they
            can&apos;t, the claim is escalated and AuctionHous decides it, using the listing, photos, tracking and
            messages. Either side may appeal a decision once, and the appeal decision is final on the Service.
          </li>
          <li>
            <Term label="What's covered" />{" "}Who is responsible in each situation is set out in our{" "}
            <Link href="/seller-terms#disputes">Seller Agreement</Link>. Changing your mind isn&apos;t covered.
          </li>
          <li>
            <Term label="Refunds" />{" "}Approved refunds go back to the original payment method.
          </li>
          <li>
            <Term label="Chargebacks" />{" "}Please use the claims process rather than disputing a charge with your
            bank. Filing a chargeback for an order you received as described, or abusing chargebacks, can lead to a
            permanent ban.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "prohibited",
    title: "What's not allowed",
    body: (
      <>
        <p>You may not use the Service to:</p>
        <ul>
          <li>
            Sell counterfeit, replica or proxy cards (unless clearly sold as such where we allow it), fake or
            tampered grading slabs, stolen goods, or anything illegal to sell.
          </li>
          <li>Misrepresent an item&apos;s condition, grade, authenticity or ownership.</li>
          <li>
            Bid on your own items, have someone bid for you to raise the price (shill bidding), or manipulate
            reviews, sales counts or seller tiers.
          </li>
          <li>Arrange to complete a sale outside AuctionHous to avoid fees.</li>
          <li>Harass, threaten or spam other members, or misuse their personal information.</li>
          <li>Open new accounts to get around a suspension or ban.</li>
          <li>
            Scrape, copy or overload the Service, get around its security, or use bots without our permission.
          </li>
          <li>Break any law, or infringe anyone&apos;s intellectual property or other rights.</li>
        </ul>
      </>
    ),
  },
  {
    id: "content",
    title: "Your content",
    body: (
      <>
        <p>
          You keep ownership of the photos, descriptions, messages and reviews you post (&ldquo;your
          content&rdquo;). You give AuctionHous a worldwide, non-exclusive, royalty-free license to host, display,
          resize and use your content to run and promote the Service, including after an item sells. This license
          ends when your content is removed, except for copies we keep as part of order records or as the law
          requires.
        </p>
        <p>
          You confirm you have the right to post your content. We may remove content that breaks these Terms. To
          report content that infringes your copyright, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
          with the details required by the Digital Millennium Copyright Act.
        </p>
      </>
    ),
  },
  {
    id: "reviews",
    title: "Reviews and messages",
    body: (
      <p>
        Reviews must be honest and based on a real transaction. Don&apos;t offer or demand anything in exchange for a
        review. We may remove reviews and messages that break these Terms. Messages can be reviewed by our team when
        a claim is opened or when we&apos;re investigating fraud, abuse or a report.
      </p>
    ),
  },
  {
    id: "ip",
    title: "Our intellectual property",
    body: (
      <p>
        The Service, including its design, software and the AuctionHous name and logo, belongs to AuctionHous. You may
        use the Service only as these Terms allow. Card game names, card names and artwork belong to their owners.
        AuctionHous isn&apos;t affiliated with or endorsed by any card publisher or grading company.
      </p>
    ),
  },
  {
    id: "termination",
    title: "Suspension and closing your account",
    body: (
      <>
        <p>
          We may limit, suspend or close your account, remove listings, or cancel orders if we reasonably believe
          you&apos;ve broken these Terms, created risk or legal exposure for us or others, or are involved in fraud.
          Where appropriate, we&apos;ll tell you why.
        </p>
        <p>
          You can delete your account at any time from <Link href="/account/settings">Account Settings</Link> once
          you have no orders, claims or auctions in progress. Sections that by their nature should survive — such as
          payment obligations, Sections 14 to 19, and our rights to records we must keep — continue after your
          account is closed.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE.&rdquo; TO THE FULLEST EXTENT ALLOWED BY
        LAW, AUCTIONHOUS DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. WE DON&apos;T WARRANT THAT THE SERVICE WILL BE
        UNINTERRUPTED OR ERROR-FREE, OR MAKE ANY PROMISE ABOUT ITEMS LISTED BY MEMBERS, INCLUDING THEIR QUALITY,
        SAFETY, AUTHENTICITY OR LEGALITY.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p>
          TO THE FULLEST EXTENT ALLOWED BY LAW, AUCTIONHOUS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
          SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA OR GOODWILL, ARISING FROM YOUR USE
          OF THE SERVICE OR ANY TRANSACTION WITH ANOTHER MEMBER.
        </p>
        <p>
          OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF (A) THE FEES YOU
          PAID US IN THE 12 MONTHS BEFORE THE CLAIM AROSE OR (B) $100.
        </p>
        <p>
          Some places don&apos;t allow these limits, so they may not all apply to you. Nothing in these Terms limits
          liability that can&apos;t be limited by law.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnification",
    body: (
      <p>
        You agree to defend, indemnify and hold harmless AuctionHous and its owners, employees and agents from any
        claims, losses and costs (including reasonable attorneys&apos; fees) arising from your content, your
        listings or sales, your breach of these Terms, or your violation of any law or anyone else&apos;s rights.
      </p>
    ),
  },
  {
    id: "member-disputes",
    title: "Disputes between members",
    body: (
      <>
        <p>
          Our claims process (Section 8) is the way to resolve problems with an order on AuctionHous. We aren&apos;t
          required to get involved in disputes between members beyond it.
        </p>
        <p>
          To the extent allowed by law, you release AuctionHous from claims, demands and damages arising from
          disputes with other members. If you are a California resident, you waive California Civil Code §1542,
          which says: &ldquo;A general release does not extend to claims that the creditor or releasing party does
          not know or suspect to exist in his or her favor at the time of executing the release and that, if known
          by him or her, would have materially affected his or her settlement with the debtor or released
          party.&rdquo;
        </p>
      </>
    ),
  },
  {
    id: "arbitration",
    title: "Resolving disputes with AuctionHous: arbitration",
    body: (
      <>
        <p>
          <Term label="Talk to us first" />{" "}Before starting a formal case, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with a description of the dispute and what you&apos;re
          asking for. We&apos;ll try to resolve it informally within 60 days.
        </p>
        <p>
          <Term label="Binding arbitration" />{" "}If we can&apos;t resolve it, you and AuctionHous agree that any
          dispute arising from these Terms or the Service will be resolved by binding individual arbitration
          administered by the American Arbitration Association under its Consumer Arbitration Rules, rather than in
          court. The arbitrator decides all issues, including whether a dispute must be arbitrated. Arbitration can
          take place by video or phone, or in the county where you live. We&apos;ll pay arbitration filing and
          administration fees beyond what you would pay to file in court, unless the arbitrator finds your claim
          frivolous.
        </p>
        <p>
          <Term label="Exceptions" />{" "}Either of us may bring an individual claim in small claims court instead, or
          go to court over intellectual property misuse.
        </p>
        <p>
          <Term label="No class actions" />{" "}You and AuctionHous may bring claims against each other only
          individually, not as a plaintiff or class member in any class, collective or representative action, and
          the arbitrator may not combine more than one person&apos;s claims. YOU AND AUCTIONHOUS EACH WAIVE THE
          RIGHT TO A JURY TRIAL.
        </p>
        <p>
          <Term label="Public injunctive relief" />{" "}Nothing in this section stops you from seeking public
          injunctive relief where the law allows it. Any such request will be decided by a court, after the
          individual claims are arbitrated.
        </p>
        <p>
          <Term label="Opting out" />{" "}You can opt out of this arbitration agreement within 30 days of first
          accepting these Terms by emailing <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with your name,
          username and a clear statement that you opt out of arbitration. Opting out doesn&apos;t affect the rest of
          these Terms.
        </p>
        <p>
          If the class action waiver is found unenforceable for a claim, that claim will be decided in court, not in
          arbitration. If any other part of this section is found unenforceable, the rest still applies.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These Terms are governed by the laws of the State of California and applicable US federal law, including the
        Federal Arbitration Act, without regard to conflict-of-law rules. Any dispute not subject to arbitration
        will be decided by the state or federal courts located in California, and you and AuctionHous consent to
        their jurisdiction.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these Terms",
    body: (
      <p>
        We may update these Terms. If we make a material change, we&apos;ll update the effective date and ask you to
        review and accept the new version the next time you use the Service. Changes don&apos;t apply to disputes
        that arose before they took effect.
      </p>
    ),
  },
  {
    id: "general",
    title: "General",
    body: (
      <ul>
        <li>
          These Terms, the Privacy Policy and (if you sell) the Seller Agreement are the entire agreement between
          you and AuctionHous about the Service.
        </li>
        <li>If any part of these Terms can&apos;t be enforced, the rest stays in effect.</li>
        <li>If we don&apos;t enforce a right right away, we haven&apos;t given it up.</li>
        <li>
          You may not transfer these Terms or your account. We may transfer them as part of a merger, sale or
          reorganization.
        </li>
        <li>We may send you notices by email or through the Service.</li>
      </ul>
    ),
  },
  {
    id: "contact",
    title: "Contact us",
    body: (
      <p>
        Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>, or visit{" "}
        <Link href="/support">Help &amp; Support</Link>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      effectiveDate={TERMS_EFFECTIVE_DATE}
      intro={
        <p>
          The rules for buying, selling and using AuctionHous. The short version: be honest, pay and ship on time,
          use the claims process when something goes wrong, and keep it on the platform.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
