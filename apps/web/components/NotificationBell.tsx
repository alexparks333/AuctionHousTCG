"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  BellRing,
  CheckCheck,
  ChevronRight,
  PackagePlus,
} from "lucide-react";
import {
  getMyNotificationsClient,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import {
  KIND_META,
  NotificationThumb,
  notificationHref,
} from "@/components/notifications/notificationMeta";

// Thumbnails warmed in the background on page load, so the popup opens with
// its photos already there (the first resize of a photo is the slow part).
const WARM_THUMBS = 12;

const POLL_MS = 15000;

// Server-fetched initial state (Header passes these down), then kept
// current with a plain poll — same reasoning as CelebrationWatcher, just a
// persistent list instead of a one-time toast, so there's no "poke on my
// own action" fast path needed here the way the celebration toast has.
export default function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: AppNotification[];
  initialUnreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getMyNotificationsClient();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Best-effort — a missed poll just gets retried next interval.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleOpenNotification(n: AppNotification) {
    setOpen(false);
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

  async function handleMarkAllRead() {
    setUnreadCount(0);
    setNotifications((prev) =>
      prev.map((p) => ({ ...p, readAt: p.readAt ?? new Date().toISOString() })),
    );
    markAllNotificationsRead().catch(() => {});
  }

  const shown =
    filter === "unread"
      ? notifications.filter((n) => !n.readAt)
      : notifications;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
        className={`relative flex items-center rounded-full p-2.5 transition-colors ${
          open
            ? "bg-brand-navy text-brand-gold-light"
            : "text-gray-700 hover:bg-brand-surface"
        }`}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-urgent px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Hidden, eagerly-loaded copies of the popup's thumbnails (same
          size, so the same cached file) — see WARM_THUMBS. */}
      <div hidden aria-hidden>
        {notifications.slice(0, WARM_THUMBS).map((n) => (
          <NotificationThumb key={n.id} n={n} size="sm" eager />
        ))}
      </div>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-[min(21rem,calc(100vw-2rem))] origin-top-right animate-step-enter overflow-hidden rounded-2xl border border-brand-border bg-white shadow-2xl shadow-brand-navy/15"
        >
          {/* Header band */}
          <div className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 px-4 pb-2.5 pt-3 text-white">
            <div
              aria-hidden
              className="absolute -right-10 -top-12 h-28 w-28 rounded-full bg-brand-gold/25 blur-2xl"
            />
            <div className="relative flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-brand-gold-light ring-1 ring-white/15">
                  <BellRing size={14} />
                </span>
                <div>
                  <p className="text-sm font-bold leading-tight">
                    Notifications
                  </p>
                  <p className="text-[11px] text-white/60">
                    {unreadCount > 0
                      ? `${unreadCount} unread`
                      : "You're all caught up"}
                  </p>
                </div>
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/15 transition-colors hover:bg-white/20"
                >
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
            </div>
            <div className="relative mt-2.5 flex gap-1 text-[11px] font-semibold">
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
                  className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors ${
                    filter === value
                      ? "bg-white text-brand-navy"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  {label}
                  <span
                    className={`rounded-full px-1.5 text-[10px] ${
                      filter === value
                        ? "bg-brand-navy/10 text-brand-navy"
                        : "bg-white/10"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[21rem] overflow-y-auto overscroll-contain">
            {shown.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-8 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-surface text-gray-400">
                  <Bell size={18} />
                </span>
                <p className="mt-2 text-sm font-semibold text-gray-900">
                  {filter === "unread"
                    ? "No unread notifications"
                    : "No notifications yet"}
                </p>
              </div>
            ) : (
              <ul className="p-1.5">
                {shown.map((n) => {
                  const meta = KIND_META[n.kind];
                  const unread = !n.readAt;
                  return (
                    <li key={n.id}>
                      <Link
                        href={notificationHref(n)}
                        role="menuitem"
                        onClick={(e) => {
                          e.preventDefault();
                          handleOpenNotification(n);
                        }}
                        className={`group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors ${
                          unread
                            ? "bg-amber-50/60 hover:bg-amber-50"
                            : "hover:bg-brand-surface"
                        }`}
                      >
                        {unread && (
                          <span
                            aria-hidden
                            className="absolute inset-y-2.5 left-0 w-1 rounded-full bg-brand-gold"
                          />
                        )}
                        <NotificationThumb n={n} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`line-clamp-2 text-[13px] leading-snug ${
                              unread
                                ? "font-semibold text-gray-900"
                                : "text-gray-600"
                            }`}
                          >
                            {meta.text(n.listingTitle)}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                            <span
                              className={`rounded-full px-1.5 py-px text-[10px] font-bold ${meta.tint}`}
                            >
                              {meta.label}
                            </span>
                            {/* The order had singles/other cards added at
                                    checkout ("Add Singles To Your Order"). */}
                            {n.isBundle && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-gold px-1.5 py-px text-[10px] font-bold text-white">
                                <PackagePlus size={9} /> Bundle
                              </span>
                            )}
                            {/* Date.now()-based text — see ThreadListItem's
                                    matching comment for why this needs
                                    suppressHydrationWarning. */}
                            <span
                              className="text-gray-400"
                              suppressHydrationWarning
                            >
                              {formatRelativeTime(n.createdAt)}
                            </span>
                          </span>
                        </span>
                        <ChevronRight
                          size={14}
                          className="shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-gray-500"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Link
            href="/account/notifications"
            onClick={() => setOpen(false)}
            className="group flex items-center justify-center gap-1 border-t border-brand-border px-4 py-2 text-[11px] font-semibold text-brand-navy transition-colors hover:bg-brand-surface"
          >
            See all notifications
            <ArrowRight
              size={12}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      )}
    </div>
  );
}
