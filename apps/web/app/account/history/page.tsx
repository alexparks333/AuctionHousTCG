import Link from "next/link";
import { ShoppingBag, Tag } from "lucide-react";
import { getMyPurchases, getMySales } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import PurchaseHistoryTable from "@/components/PurchaseHistoryTable";
import HistoryPager, { HISTORY_PAGE_SIZE, historyPage } from "@/components/HistoryPager";

type View = "sold" | "bought";

// Buy History and Sold History in one place: a Sold / Bought toggle
// (?view=), ten rows per page (?page=). The old /account/buy-history and
// /account/sold-history routes redirect here.
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const view: View = params.view === "bought" ? "bought" : "sold";

  // app/account/layout.tsx already gates this route on a real verified
  // session, so a local cookie read for the access_token is all this page
  // needs. Both lists are fetched so each toggle can show its count.
  const local = await getLocalSession();
  const [sales, purchases] = local
    ? await Promise.all([getMySales(local.accessToken), getMyPurchases(local.accessToken)])
    : [[], []];

  const rows = view === "sold" ? sales : purchases;
  const page = historyPage(params.page, rows.length);

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">History</h1>
          <p className="mt-1 text-sm text-gray-500">
            {view === "sold"
              ? "Everything you've sold, whether you've been paid for it yet or not."
              : "Everything you've bought, whether it's been paid for yet or not."}
          </p>
        </div>
        <nav aria-label="History type" className="flex rounded-full bg-white p-1 text-sm font-semibold ring-1 ring-brand-border">
          {(
            [
              ["sold", "Sold", sales.length, Tag],
              ["bought", "Bought", purchases.length, ShoppingBag],
            ] as const
          ).map(([value, label, count, Icon]) => {
            const active = view === value;
            return (
              <Link
                key={value}
                href={`/account/history?view=${value}`}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-colors ${
                  active ? "bg-brand-navy text-white shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <Icon size={14} />
                {label}
                <span
                  className={`rounded-full px-1.5 text-[11px] ${active ? "bg-white/20" : "bg-brand-surface text-gray-500"}`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <PurchaseHistoryTable
        items={rows.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)}
        role={view === "sold" ? "selling" : undefined}
      />
      <HistoryPager basePath={`/account/history?view=${view}`} page={page} total={rows.length} />
    </div>
  );
}
