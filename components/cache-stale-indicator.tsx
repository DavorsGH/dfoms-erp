"use client";

function formatMinutesAgo(cachedAtIso: string | null): string | null {
  if (!cachedAtIso) {
    return null;
  }
  const cachedMs = Date.parse(cachedAtIso);
  if (Number.isNaN(cachedMs)) {
    return null;
  }
  const minutes = Math.max(0, Math.floor((Date.now() - cachedMs) / 60_000));
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
  const label = formatMinutesAgo(cachedAt);
  if (!label) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span>Updated {label}</span>
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
