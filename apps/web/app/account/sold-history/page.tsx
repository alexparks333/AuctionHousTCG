import { redirect } from "next/navigation";

// Merged into /account/history (Sold / Bought toggle); kept so old links
// and bookmarks still land in the right place.
export default async function LegacySoldHistoryRedirect({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  redirect(`/account/history?view=sold${page ? `&page=${encodeURIComponent(page)}` : ""}`);
}
