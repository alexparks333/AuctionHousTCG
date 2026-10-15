import Link from "next/link";
import { ArrowRight, Landmark, Percent, Truck, Users } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata = {
  title: "About | AuctionHous - TCG",
};

const POINTS = [
  {
    icon: Percent,
    title: "Low fees, published in full",
    body: "Sellers pay 5.50%–7.00% + $0.30 depending on their tier — about half what other providers charge — and every rate is on the fees page.",
    href: "/tiers",
    link: "See the fees",
  },
  {
    icon: Landmark,
    title: "Protected payments",
    body: "Buyers pay through Stripe, and the seller is paid once the order arrives as described — so both sides are covered if something goes wrong.",
  },
  {
    icon: Truck,
    title: "Tracked shipping on every order",
    body: "Every label bought here is tracked — even a single card in an envelope.",
  },
  {
    icon: Users,
    title: "Built for players and collectors",
    body: "Riftbound first. Buy one card, or add a seller's singles to your order and get them all in one package.",
  },
];

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />

      <section className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 text-white">
        <div aria-hidden className="absolute -right-32 -top-40 h-[26rem] w-[26rem] rounded-full bg-brand-gold/20 blur-3xl" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-6 pb-24 pt-14 text-center sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-gold-light">About AuctionHous</p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">
            The Marketplace{" "}
            <span className="bg-gradient-to-r from-brand-gold-light via-amber-200 to-brand-gold bg-clip-text text-transparent">
              for the People
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-white/75">
            AuctionHous is a marketplace where card players and collectors buy and sell with each other. Our goal is
            simple: keep fees as low as possible, so more of every sale stays with the people making it.
          </p>
        </div>
      </section>

      <main className="relative mx-auto -mt-12 w-full max-w-4xl flex-1 px-6 pb-16 sm:px-10">
        <div className="grid gap-4 sm:grid-cols-2">
          {POINTS.map(({ icon: Icon, title, body, href, link }) => (
            <div key={title} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-border">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-navy text-brand-gold-light">
                <Icon size={18} />
              </span>
              <h2 className="mt-4 text-base font-bold text-gray-900">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{body}</p>
              {href && (
                <Link
                  href={href}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:text-brand-gold"
                >
                  {link} <ArrowRight size={14} />
                </Link>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-brand-border sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="font-bold text-gray-900">Questions?</p>
            <p className="text-sm text-gray-500">We&apos;re happy to help with anything account, listing or order related.</p>
          </div>
          <Link
            href="/support"
            className="shrink-0 rounded-full bg-brand-gold px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-gold/30 transition-colors hover:bg-brand-gold-light"
          >
            Help &amp; Support
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
