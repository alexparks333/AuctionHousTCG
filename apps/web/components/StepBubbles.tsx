import { Camera, Check, FileText, Tag } from "lucide-react";

const STEPS = [
  { label: "Details", hint: "What card is it?", Icon: FileText },
  { label: "Photos", hint: "Show its condition", Icon: Camera },
  { label: "Price", hint: "Price & shipping", Icon: Tag },
];

// The Sell wizard's progress tracker: each step's icon, name and a short
// hint, joined by bars that fill in as steps are completed.
export default function StepBubbles({
  current,
  onStepClick,
}: {
  current: number;
  // Only steps already reached (done or the current one) are clickable —
  // jumping ahead to an unfilled step would skip that step's own required-
  // field validation (e.g. Step1's title), so "back to a previous step"
  // only, same convention most wizards use for their own breadcrumbs.
  onStepClick?: (step: number) => void;
}) {
  return (
    <ol className="flex items-center">
      {STEPS.map(({ label, hint, Icon }, i) => {
        const step = i + 1;
        const state = step < current ? "done" : step === current ? "active" : "upcoming";
        const clickable = step < current && Boolean(onStepClick);

        return (
          <li key={label} className={`flex items-center ${step < STEPS.length ? "flex-1" : ""}`}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(step)}
              aria-label={`Go to step ${step}: ${label}`}
              aria-current={state === "active" ? "step" : undefined}
              className={`group flex items-center gap-3 rounded-xl text-left ${
                clickable ? "cursor-pointer" : state === "active" ? "cursor-default" : "cursor-not-allowed"
              }`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all duration-300 ${
                  state === "done"
                    ? "bg-brand-navy text-brand-gold-light group-hover:bg-brand-navy-light"
                    : state === "active"
                      ? "bg-brand-gold text-white shadow-lg shadow-brand-gold/30 ring-4 ring-brand-gold/15"
                      : "bg-gray-100 text-gray-400"
                }`}
              >
                {state === "done" ? <Check size={18} strokeWidth={2.5} className="animate-pop-in" /> : <Icon size={18} />}
              </span>
              <span className="hidden sm:block">
                <span
                  className={`block text-sm font-semibold leading-tight ${
                    state === "upcoming" ? "text-gray-400" : "text-gray-900"
                  }`}
                >
                  {label}
                </span>
                <span className="block text-xs text-gray-400">{hint}</span>
              </span>
            </button>
            {step < STEPS.length && (
              <span className="relative mx-3 h-1 flex-1 overflow-hidden rounded-full bg-gray-100 sm:mx-4">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-navy to-brand-gold transition-all duration-500 ease-out"
                  style={{ width: step < current ? "100%" : "0%" }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
