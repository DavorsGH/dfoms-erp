"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  resolveLandlordNotificationHref,
  type LandlordNotificationRow,
} from "@/utils/landlord-notifications-types";

const PAGE_SIZE = 20;

function formatSentAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 16);
  }
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export default function LandlordNotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<LandlordNotificationRow[]>(
    [],
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingRead, setClearingRead] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshUnread = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/landlord-portal/notifications?limit=1&offset=0`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { unreadCount?: number };
      setUnreadCount(payload.unreadCount ?? 0);
    } catch {
      // Ignore background badge refresh failures.
    }
  }, []);

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(
        `/api/landlord-portal/notifications?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      const payload = (await response.json()) as {
        notifications?: LandlordNotificationRow[];
        unreadCount?: number;
        hasMore?: boolean;
        error?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Failed to load notifications.");
        return;
      }

      const rows = payload.notifications ?? [];
      setNotifications((current) => (append ? [...current, ...rows] : rows));
      setUnreadCount(payload.unreadCount ?? 0);
      setHasMore(payload.hasMore === true);
    } catch {
      setError("Failed to load notifications.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
    const interval = window.setInterval(() => {
      void refreshUnread();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshUnread]);

  useEffect(() => {
    if (!open) return;
    void loadPage(0, false);
  }, [open, loadPage]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function markRead(row: LandlordNotificationRow) {
    if (row.read_at) return;

    const response = await fetch(
      `/api/landlord-portal/notifications/${row.id}`,
      { method: "PATCH" },
    );
    const payload = (await response.json()) as {
      notification?: LandlordNotificationRow;
      error?: string;
    };

    if (!response.ok || !payload.notification) {
      setError(payload.error ?? "Failed to mark notification as read.");
      return;
    }

    setNotifications((current) =>
      current.map((item) =>
        item.id === row.id ? payload.notification! : item,
      ),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
  }

  async function handleSelect(row: LandlordNotificationRow) {
    const href = resolveLandlordNotificationHref(row);
    await markRead(row);

    if (href) {
      setOpen(false);
      router.push(href);
      return;
    }

    setExpandedId((current) => (current === row.id ? null : row.id));
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    setError(null);
    const response = await fetch(
      "/api/landlord-portal/notifications/mark-all-read",
      { method: "PATCH" },
    );
    const payload = (await response.json()) as { error?: string };
    setMarkingAll(false);

    if (!response.ok) {
      setError(payload.error ?? "Failed to mark all as read.");
      return;
    }

    const now = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) =>
        item.read_at ? item : { ...item, read_at: now },
      ),
    );
    setUnreadCount(0);
  }

  async function handleDelete(row: LandlordNotificationRow) {
    setDeletingId(row.id);
    setError(null);
    const response = await fetch(
      `/api/landlord-portal/notifications/${row.id}`,
      { method: "DELETE" },
    );
    const payload = (await response.json()) as { error?: string };
    setDeletingId(null);

    if (!response.ok) {
      setError(payload.error ?? "Failed to delete notification.");
      return;
    }

    const wasUnread = row.read_at == null;
    setNotifications((current) =>
      current.filter((item) => item.id !== row.id),
    );
    if (wasUnread) {
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    if (expandedId === row.id) {
      setExpandedId(null);
    }
  }

  async function handleClearAllRead() {
    setClearingRead(true);
    setError(null);
    const response = await fetch(
      "/api/landlord-portal/notifications/clear-all-read",
      { method: "DELETE" },
    );
    const payload = (await response.json()) as { error?: string };
    setClearingRead(false);

    if (!response.ok) {
      setError(payload.error ?? "Failed to clear read notifications.");
      return;
    }

    setNotifications((current) =>
      current.filter((item) => item.read_at == null),
    );
  }

  const hasReadNotifications = notifications.some((row) => row.read_at != null);

  const badgeLabel =
    unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        className="relative rounded-md p-2 text-[#0f2744] transition-colors hover:bg-slate-100"
      >
        <BellIcon />
        {badgeLabel ? (
          <span className="absolute right-0.5 top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-[#0f2744]">
              Notifications
            </h2>
            <div className="flex shrink-0 items-center gap-3">
              {hasReadNotifications ? (
                <button
                  type="button"
                  disabled={clearingRead}
                  onClick={() => void handleClearAllRead()}
                  className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50"
                >
                  {clearingRead ? "Clearing…" : "Clear all read"}
                </button>
              ) : null}
              {unreadCount > 0 ? (
                <button
                  type="button"
                  disabled={markingAll}
                  onClick={() => void handleMarkAllRead()}
                  className="text-xs font-medium text-[#0f2744] hover:underline disabled:opacity-50"
                >
                  {markingAll ? "Marking…" : "Mark all as read"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {error ? (
              <p className="px-4 py-3 text-sm text-red-700">{error}</p>
            ) : null}

            {loading ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                Loading…
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                No notifications yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.map((row) => {
                  const unread = row.read_at == null;
                  const expanded = expandedId === row.id;

                  return (
                    <li
                      key={row.id}
                      className={`flex items-stretch ${
                        unread ? "bg-sky-50/60" : "bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void handleSelect(row)}
                        className="min-w-0 flex-1 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                      >
                        <div className="flex items-start gap-2">
                          {unread ? (
                            <span
                              aria-hidden
                              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-600"
                            />
                          ) : (
                            <span
                              aria-hidden
                              className="mt-1.5 h-2 w-2 shrink-0"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-sm ${
                                unread
                                  ? "font-semibold text-slate-900"
                                  : "font-medium text-slate-800"
                              }`}
                            >
                              {row.title}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {formatSentAt(row.created_at)}
                            </p>
                            {expanded ? (
                              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                                {row.body}
                              </p>
                            ) : (
                              <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                                {row.body}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete notification: ${row.title}`}
                        disabled={deletingId === row.id}
                        onClick={() => void handleDelete(row)}
                        className="shrink-0 px-3 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-red-700 disabled:opacity-50"
                      >
                        {deletingId === row.id ? "…" : "Delete"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {hasMore ? (
            <div className="border-t border-slate-100 px-4 py-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadPage(notifications.length, true)}
                className="w-full rounded-md px-3 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
