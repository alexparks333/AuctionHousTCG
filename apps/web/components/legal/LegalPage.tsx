import type { ReactNode } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export type LegalSection = { id: string; title: string; body: ReactNode };

// Shared layout for the site's legal pages (Privacy Policy, and the Terms
// of Service once written): navy banner with the effective date, a sticky
// contents list on wide screens, and each section as its own card.
export default function LegalPage({
  eyebrow,
  title,
  effectiveDate,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  effectiveDate: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />

      <section className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 text-white">
        <div aria-hidden className="absolute -right-32 -top-40 h-[26rem] w-[26rem] rounded-full bg-brand-gold/15 blur-3xl" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-12 sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-gold-light">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-white/60">Effective {effectiveDate}</p>
          <div className="mt-4 max-w-2xl text-base text-white/75">{intro}</div>
        </div>
      </section>

      <main className="relative mx-auto -mt-10 grid w-full max-w-6xl flex-1 gap-8 px-6 pb-16 sm:px-10 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Contents" className="hidden lg:block">
          <div className="sticky top-24 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-border">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Contents</p>
            <ol className="mt-2 space-y-0.5 text-sm">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="flex gap-2 rounded-lg px-2 py-1.5 text-gray-600 transition-colors hover:bg-brand-surface hover:text-brand-navy"
                  >
                    <span className="w-4 shrink-0 text-right text-gray-300">{i + 1}</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="space-y-5">
          {sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              className="scroll-mt-24 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-border sm:p-8"
            >
              <h2 className="flex items-baseline gap-3 text-lg font-bold tracking-tight text-gray-900">
                <span className="text-sm font-semibold text-brand-gold">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-gray-600 [&_a]:font-medium [&_a]:text-brand-navy [&_a]:underline [&_a:hover]:text-brand-gold [&_li]:pl-1 [&_strong]:text-gray-900 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}
