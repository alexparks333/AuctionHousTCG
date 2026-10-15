import { redirect } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCurrentSession } from "@/lib/session";

// A deliberately separate top-level route from app/account/*, not just a
// nested one — app/account/layout.tsx renders AccountTabs unconditionally
// for everything under it, and Next.js layouts nest (a child can add to
// an ancestor's chrome, never opt out of it), so the only way for these
// single-task KYC pages to drop both the category-bubble row AND the
// account-tabs row is to sit outside that layout's subtree entirely.
// Category bubbles are suppressed via Header's own showCategoryNav flag;
// the account tabs row simply doesn't exist here, since this layout never
// renders AccountTabs at all.
export default async function VerifyLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const { user } = await getCurrentSession();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header showCategoryNav={false} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
