"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronRight, PackagePlus } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import {
  KIND_META,
  NotificationThumb,
  groupByDay,
  notificationHref,
} from "./notificationMeta";

// The full /account/notifications page: every notification, an All/Unread
// toggle, grouped by Today / Yesterday / This week / Earlier. The header
// bell only shows a short preview and links here.
export default function NotificationsFeed({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: AppNotification[];
  initialUnreadCount: number;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  function open(n: AppNotification) {
    if (!n.readAt) {
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((p) =>
          p.id === n.id ? { ...p, readAt: new Date().toISOString() } : p,
        ),
      );
      markNotificationRead(n.id).catch(() => {});
    }
    router.push(notificationHref(n));
  }

  function markAll() {
    setUnreadCount(0);
    setNotifications((prev) =>
      prev.map((p) => ({ ...p, readAt: p.readAt ?? new Date().toISOString() })),
    );
    markAllNotificationsRead().catch(() => {});
    router.refresh();
  }

  const shown =
    filter === "unread"
      ? notifications.filter((n) => !n.readAt)
      : notifications;
  // Day groups depend on the viewer's timezone, so they're only built in
  // the browser; the server render is one ungrouped list.
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const groups = isClient ? groupByDay(shown) : [{ label: "", items: shown }];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-navy text-brand-gold-light">
            <Bell size={19} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              Notifications
            </h1>
            <p className="text-sm text-gray-500">
              {unreadCount > 0
                ? `${unreadCount} unread`
                : "You're all caught up"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-white p-1 text-sm font-semibold ring-1 ring-brand-border">
            {(
              [
                ["all", "All", notifications.length],
                ["unread", "Unread", unreadCount],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors ${
                  filter === value
                    ? "bg-brand-navy text-white"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
                <span
                  className={`rounded-full px-1.5 text-[11px] ${
                    filter === value
                      ? "bg-white/20"
                      : "bg-brand-surface text-gray-500"
                  }`}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAll}
              className="flex items-center gap-1.5 rounded-full border border-brand-border bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-brand-navy hover:text-brand-navy"
            >
              <CheckCheck size={15} /> Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-brand-border bg-white shadow-sm">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-surface text-gray-400">
              <Bell size={22} />
            </span>
            <p className="mt-3 font-semibold text-gray-900">
              {filter === "unread"
                ? "No unread notifications"
                : "No notifications yet"}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Sales, offers, bids and reviews will show up here.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label || "all"}>
              {group.label && (
                <h2 className="border-b border-brand-border bg-brand-surface/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                  {group.label}
                </h2>
              )}
              <ul>
                {group.items.map((n) => {
                  const meta = KIND_META[n.kind];
                  const unread = !n.readAt;
                  return (
                    <li
                      key={n.id}
                      className="border-b border-brand-border/70 last:border-0"
                    >
                      <Link
                        href={notificationHref(n)}
                        onClick={(e) => {
                          e.preventDefault();
                          open(n);
                        }}
                        className={`group relative flex items-center gap-4 px-5 py-3.5 transition-colors ${
                          unread
                            ? "bg-amber-50/50 hover:bg-amber-50"
                            : "hover:bg-brand-surface"
                        }`}
                      >
                        {unread && (
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 w-1 bg-brand-gold"
                          />
                        )}
                        <NotificationThumb n={n} />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-sm leading-snug ${unread ? "font-semibold text-gray-900" : "text-gray-700"}`}
                          >
                            {meta.text(n.listingTitle)}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.tint}`}
                            >
                              {meta.label}
                            </span>
                            {n.isBundle && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-brand-gold px-2 py-0.5 text-[10px] font-bold text-white">
                                <PackagePlus size={10} /> Bundle
                              </span>
                            )}
                            <span
                              className="text-gray-400"
                              suppressHydrationWarning
                            >
                              {formatRelativeTime(n.createdAt)}
                            </span>
                          </span>
                        </span>
                        <ChevronRight
                          size={17}
                          className="shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-gray-500"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function noopSubscribe() {
  return () => {};
}
