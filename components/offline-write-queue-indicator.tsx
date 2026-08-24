"use client";

import { useWriteQueueOptional } from "@/components/write-queue-provider";

/**
 * Persistent staff-shell indicator for pending/failed offline writes + Sync now.
 */
export default function OfflineWriteQueueIndicator() {
  const queue = useWriteQueueOptional();
  if (!queue || queue.openCount === 0) {
    return null;
  }

  const parts: string[] = [];
  if (queue.pendingCount > 0) {
    parts.push(
      `${queue.pendingCount} pending sync${queue.pendingCount === 1 ? "" : "s"}`,
    );
  }
  if (queue.failedCount > 0) {
    parts.push(
      `${queue.failedCount} failed${queue.failedCount === 1 ? "" : "s"}`,
    );
  }
  if (queue.syncingCount > 0) {
    parts.push("syncing…");
  }

  return (
    <div
      role="status"
      className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-950"
    >
      <span>
        Offline write queue: {parts.join(" · ") || `${queue.openCount} item(s)`}
        {queue.failedCount > 0
          ? " — open Attendance or Expenses to retry or discard failed items."
          : ""}
      </span>
      <button
        type="button"
        onClick={() => void queue.syncNow()}
        disabled={queue.draining || !navigator.onLine}
        className="rounded-md border border-sky-300 bg-white px-3 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {queue.draining ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
