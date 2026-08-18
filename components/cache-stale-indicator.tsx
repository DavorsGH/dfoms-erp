"use client";

import { useEffect, useRef, useState } from "react";

const TICK_INTERVAL_MS = 30_000;
const FRESH_FLASH_MS = 1_500;

export function formatMinutesAgo(
  cachedAtIso: string | null,
  nowMs: number = Date.now(),
): string | null {
  if (!cachedAtIso) {
    return null;
  }
  const cachedMs = Date.parse(cachedAtIso);
  if (Number.isNaN(cachedMs)) {
    return null;
  }
  const minutes = Math.max(0, Math.floor((nowMs - cachedMs) / 60_000));
  if (minutes <= 0) {
    return "just now";
  }
  if (minutes === 1) {
    return "1 min ago";
  }
  return `${minutes} min ago`;
}

type CacheStaleIndicatorProps = {
  cachedAt: string | null;
  onRefresh: () => void;
  refreshing?: boolean;
};

export default function CacheStaleIndicator({
  cachedAt,
  onRefresh,
  refreshing = false,
}: CacheStaleIndicatorProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [flashFresh, setFlashFresh] = useState(false);
  const prevCachedAtRef = useRef<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!cachedAt) {
      return;
    }

    const previous = prevCachedAtRef.current;
    prevCachedAtRef.current = cachedAt;

    if (previous !== null && previous !== cachedAt) {
      setFlashFresh(true);
      const timeoutId = window.setTimeout(() => {
        setFlashFresh(false);
      }, FRESH_FLASH_MS);
      return () => window.clearTimeout(timeoutId);
    }
  }, [cachedAt]);

  const label = formatMinutesAgo(cachedAt, nowMs);
  if (!label) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span
        className={`rounded px-1 transition-colors duration-[1500ms] ease-out ${
          flashFresh ? "bg-amber-100/90 text-amber-950" : "bg-transparent"
        }`}
      >
        Updated {label}
      </span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="font-medium text-[#0f2744] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
