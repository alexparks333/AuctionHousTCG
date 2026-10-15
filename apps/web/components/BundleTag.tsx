import { PackagePlus } from "lucide-react";

// Marks an order (or a listing sold as part of one) that had singles or
// other cards added at checkout ("Add Singles To Your Order") — the same
// gold pill everywhere it appears: the notification bell, Transactions,
// and the Selling page.
export default function BundleTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-gold px-2.5 py-1 text-xs font-bold leading-none text-white shadow-sm ${className}`}
    >
      <PackagePlus size={12} /> Bundle
    </span>
  );
}
