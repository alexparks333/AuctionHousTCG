import NotificationsFeed from "@/components/notifications/NotificationsFeed";
import { getMyNotifications } from "@/lib/api";
import { getLocalSession } from "@/lib/session";

// Every notification — the header bell's popup is only a preview that links
// here. app/account/layout.tsx already gates this route on a real session.
export default async function NotificationsPage() {
  const local = await getLocalSession();
  const data = local
    ? await getMyNotifications(local.accessToken).catch(() => ({ notifications: [], unreadCount: 0 }))
    : { notifications: [], unreadCount: 0 };

  return (
    <div className="px-4 py-8 sm:px-12 lg:px-14">
      <NotificationsFeed initialNotifications={data.notifications} initialUnreadCount={data.unreadCount} />
    </div>
  );
}
