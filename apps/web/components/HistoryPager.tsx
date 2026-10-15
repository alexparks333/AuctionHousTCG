import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

// The History page (Sold / Bought) shows this many rows per page.
export const HISTORY_PAGE_SIZE = 10;

// Reads ?page= (1-based) and clamps it to the pages that exist.
export function historyPage(raw: string | string[] | undefined, total: number): number {
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const n = Number.parseInt(Array.isArray(raw) ? raw[0] : (raw ?? "1"), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), pages) : 1;
}

// "Showing 11–20 of 34" plus Previous/Next — plain links to ?page=N, so a
// page is shareable and works without client JS.
export default function HistoryPager({ basePath, page, total }: { basePath: string; page: number; total: number }) {
  const pages = Math.ceil(total / HISTORY_PAGE_SIZE);
  if (pages <= 1) return null;
  const from = (page - 1) * HISTORY_PAGE_SIZE + 1;
  const to = Math.min(page * HISTORY_PAGE_SIZE, total);
  // basePath may already carry a query (e.g. /account/history?view=sold).
  const href = (n: number) => (n === 1 ? basePath : `${basePath}${basePath.includes("?") ? "&" : "?"}page=${n}`);
  const btn = "flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium";

  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
      <p className="text-sm text-gray-500">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={`${btn} border-gray-300 text-gray-700 hover:border-brand-navy`}>
            <ChevronLeft size={15} /> Previous
          </Link>
        ) : (
          <span className={`${btn} border-gray-200 text-gray-300`} aria-disabled="true">
            <ChevronLeft size={15} /> Previous
          </span>
        )}
        <span className="px-1 text-sm text-gray-600">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className={`${btn} border-gray-300 text-gray-700 hover:border-brand-navy`}>
            Next <ChevronRight size={15} />
          </Link>
        ) : (
          <span className={`${btn} border-gray-200 text-gray-300`} aria-disabled="true">
            Next <ChevronRight size={15} />
          </span>
        )}
      </div>
    </nav>
  );
}
