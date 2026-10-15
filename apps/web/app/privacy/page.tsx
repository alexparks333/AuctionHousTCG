import Link from "next/link";
import LegalPage, { type LegalSection } from "@/components/legal/LegalPage";

// A bold "Label:" lead-in. The space after it is written explicitly where
// it's used ({" "}), since the compiled page was dropping it.
function Term({ label }: { label: string }) {
  return <strong>{label}:</strong>;
}

export const metadata = {
  title: "Privacy Policy | AuctionHous - TCG",
};

const SUPPORT_EMAIL = "support@auctionhous.net";
const EFFECTIVE_DATE = "October 15, 2026";

// Every statement here describes what the code actually does today — the
// services listed are the real integrations in apps/api (Supabase, Stripe,
// Shippo, Pitney Bowes, Google, Twilio, Resend). If a new integration is
// added, or account deletion (internal/user/delete.go) changes what it
// keeps, update this page in the same change. Have it reviewed by a lawyer
// before launch.
const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <>
        <p>
          AuctionHous - TCG (&ldquo;AuctionHous,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) runs a marketplace where
          people buy and sell trading cards with each other. This policy explains what personal information we
          collect, why, who we share it with, and the choices you have.
        </p>
        <p>
          Questions or requests about your information can go to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "Information we collect",
    body: (
      <>
        <p>
          <strong>Information you give us</strong>
        </p>
        <ul>
          <li>
            <Term label="Account details" />{" "}Your email address and password, or your name, email and profile
            picture if you sign in with Google. Passwords are handled by our authentication provider and are never
            visible to us.
          </li>
          <li>
            <Term label="Profile" />{" "}Your username and bio.
          </li>
          <li>
            <Term label="Shipping address" />{" "}Your name, street address, city, state, ZIP code, country and,
            optionally, a phone number.
          </li>
          <li>
            <Term label="Verification" />{" "}A phone number and email address we send one-time codes to, and, if you
            choose to verify your identity, the photo ID and selfie you submit to our identity provider (see
            &ldquo;Payments and identity&rdquo; below).
          </li>
          <li>
            <Term label="Marketplace activity" />{" "}Listings and their photos, bids, offers, purchases and sales,
            Singles Shop stock, your watchlist, messages you send other members, reviews and ratings, and any claims,
            evidence photos and notes you submit.
          </li>
          <li>
            <Term label="Support" />{" "}Anything you tell us when you contact us.
          </li>
        </ul>
        <p>
          <strong>Payments and identity</strong>
        </p>
        <ul>
          <li>
            Card and bank payments are processed by Stripe. Your full card number and bank login never reach our
            servers; we keep Stripe&apos;s reference IDs and basic details such as a card&apos;s brand and last four
            digits so you can pick a saved method at checkout.
          </li>
          <li>
            Sellers set up payouts through Stripe Connect. Stripe collects the details it&apos;s legally required to
            (such as your legal name, date of birth, tax ID and bank account) directly — we only see whether your
            account is set up and able to receive payments.
          </li>
          <li>
            Identity verification is done by Stripe Identity. Stripe checks your ID and selfie and tells us the
            result. To stop banned accounts from coming back, we keep a one-way, keyed fingerprint of your ID number
            and date of birth. It can&apos;t be turned back into the number itself, and we never store the number.
          </li>
        </ul>
        <p>
          <strong>Information collected automatically</strong>
        </p>
        <ul>
          <li>
            <Term label="Cookies" />{" "}We use cookies only to keep you signed in. We don&apos;t use advertising or
            analytics cookies, and we don&apos;t track you across other websites.
          </li>
          <li>
            <Term label="Browser storage" />{" "}Small preferences, such as which messages you&apos;ve already seen, are
            kept in your own browser.
          </li>
          <li>
            <Term label="Logs" />{" "}Like any website, our hosting providers record technical details of requests,
            such as IP address, browser type and the time of the request, to run the service and keep it secure.
          </li>
        </ul>
        <p>
          <Term label="Photos" />{" "}Before a photo is uploaded we resize it in your browser, which also removes hidden
          metadata such as the GPS location a phone camera may have recorded.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use",
    title: "How we use your information",
    body: (
      <ul>
        <li>To run your account and the marketplace: listings, bidding, checkout, payouts and shipping.</li>
        <li>To buy shipping labels and check that addresses are deliverable.</li>
        <li>To send you notifications and verification codes, and to answer you when you contact us.</li>
        <li>To work out seller tiers and fees from your sales history and reviews.</li>
        <li>To handle claims and disputes between buyers and sellers.</li>
        <li>
          To prevent fraud and abuse — including chargeback fraud and banned members opening new accounts — and to
          keep the service secure.
        </li>
        <li>To meet legal, tax and accounting obligations, and to enforce our terms.</li>
      </ul>
    ),
  },
  {
    id: "what-others-see",
    title: "What other members can see",
    body: (
      <>
        <ul>
          <li>
            <Term label="Anyone" />{" "}Your username, bio, profile, member-since date, seller tier, listings and their
            photos, Singles Shop, ratings and reviews, and whether the account has been banned.
          </li>
          <li>
            <Term label="Bidders" />{" "}The current price of an auction. Your maximum bid is never shown to anyone.
          </li>
          <li>
            <Term label="The other person in a sale" />{" "}Your username and your messages. When you buy, the seller
            receives your name and shipping address so they can ship to you. When you sell, your return address is
            printed on the shipping label the buyer receives.
          </li>
        </ul>
        <p>Your email address and phone number are never shown to other members.</p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who we share it with",
    body: (
      <>
        <p>We don&apos;t sell your personal information, and we don&apos;t share it for advertising.</p>
        <p>We share it only with the companies that help us run AuctionHous, for that purpose:</p>
        <ul>
          <li>
            <strong>Supabase</strong> — our database, sign-in and photo storage.
          </li>
          <li>
            <strong>Stripe</strong> — payments, seller payouts and identity verification.
          </li>
          <li>
            <strong>Shippo and Pitney Bowes</strong> — shipping labels, address checks and tracking, along with the
            carrier delivering your package (such as USPS).
          </li>
          <li>
            <strong>Google</strong> — &ldquo;Continue with Google&rdquo; sign-in, and address suggestions as you type
            an address.
          </li>
          <li>
            <strong>Twilio</strong> — text-message verification codes.
          </li>
          <li>
            <strong>Resend</strong> — email delivery.
          </li>
          <li>
            <strong>Our hosting providers</strong> — the servers that run the website.
          </li>
        </ul>
        <p>We may also share information:</p>
        <ul>
          <li>When the law requires it, such as a valid subpoena or court order.</li>
          <li>To protect the rights, property or safety of our members, the public or AuctionHous.</li>
          <li>As part of a merger, sale or reorganization of our business, under this same policy.</li>
        </ul>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it, and deleting your account",
    body: (
      <>
        <p>
          We keep your information while your account is open. You can delete your account at any time from{" "}
          <Link href="/account/settings">Account Settings</Link> once you have no orders, claims or auctions still in
          progress.
        </p>
        <p>
          <strong>When you delete your account,</strong>{" "}we delete your email, username, bio, phone number, saved
          address, watchlist and notifications; take down your unsold listings and Singles Shop stock and delete their
          photos; cancel pending
          offers; and delete your login so it can&apos;t be used again.
        </p>
        <p>
          <Term label="Some records we have to keep" />{" "}Completed orders, payment and payout records, claims, photos of items you sold, and
          reviews and messages you sent stay on file, shown to the other person as &ldquo;Deleted user.&rdquo; We
          keep these for tax and accounting law, to resolve disputes and chargebacks, and because they&apos;re part
          of the other member&apos;s history too. We also keep the identity fingerprint described above and any
          record of a ban, so a deleted account can&apos;t be used to get around one. Stripe keeps its own records
          under its own privacy policy.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "Your privacy rights",
    body: (
      <>
        <p>
          Depending on where you live — including California under the CCPA/CPRA, and several other US states — you
          may have the right to:
        </p>
        <ul>
          <li>Know what personal information we hold about you, and get a copy of it.</li>
          <li>Correct information that&apos;s wrong.</li>
          <li>Delete your information, subject to the records we must keep (see above).</li>
          <li>
            Opt out of the sale or sharing of your information for advertising — we don&apos;t do either.
          </li>
          <li>Not be treated differently for using any of these rights.</li>
        </ul>
        <p>
          You can update most details yourself in <Link href="/account/settings">Account Settings</Link> and delete
          your account there. For anything else, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from the address on your account. We&apos;ll confirm
          it&apos;s you before acting, and reply within 45 days. You can also have an authorized agent make a request
          for you, with your written permission.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        We protect your information with encrypted connections (HTTPS), access controls that keep our database
        closed to the public, and by leaving card and bank details with Stripe rather than storing them ourselves. No
        system is perfectly secure, so please use a strong, unique password and tell us right away at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> if you think your account has been compromised.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        AuctionHous is for adults. You must be at least 18 to buy or sell, and we don&apos;t knowingly collect
        information from children under 13. If you believe a child has given us their information, contact us and
        we&apos;ll delete it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change this policy, we&apos;ll update the effective date at the top. If a change is significant,
        we&apos;ll let you know on the site or by email before it takes effect.
      </p>
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

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      effectiveDate={EFFECTIVE_DATE}
      intro={
        <p>
          The short version: we collect what we need to run a card marketplace, we don&apos;t sell it, we don&apos;t
          use ad trackers, and you can delete your account whenever you like.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
