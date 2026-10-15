import type { ReactNode } from "react";

// The heading at the top of each Sell wizard step: an icon tile, "Step N of
// 3", the step's title and a one-line explanation.
export default function StepHeader({
  icon,
  step,
  title,
  children,
}: {
  icon: ReactNode;
  step: number;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-brand-gold-light shadow-md shadow-brand-navy/20">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-gold">Step {step} of 3</p>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{title}</h2>
        {children && <p className="mt-1 max-w-xl text-sm leading-relaxed text-gray-500">{children}</p>}
      </div>
    </div>
  );
}

// Back / Continue row at the bottom of each step.
export function StepFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-6">{children}</div>
  );
}

export const primaryButtonClass =
  "group inline-flex items-center gap-2 rounded-full bg-brand-gold px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-gold/25 transition-all hover:bg-brand-gold-light hover:shadow-brand-gold/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";
export const secondaryButtonClass =
  "inline-flex items-center gap-2 rounded-full border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-brand-surface";
