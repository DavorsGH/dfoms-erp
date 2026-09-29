import { AsyncLocalStorage } from "async_hooks";
import { isPerfProbeEnabled } from "@/utils/perf-probe";

type HttpCallRecord = {
  label: string;
  ms: number;
};

type HttpPerfStore = {
  calls: HttpCallRecord[];
};

const layoutHttpPerfStorage = new AsyncLocalStorage<HttpPerfStore>();

/** Set on dashboard document requests by proxy when DFOMS_PERF_PROBE=true. */
export const DFOMS_PERF_LAYOUT_PROBE_HEADER = "x-dfoms-perf-layout-probe";

const layoutProbeCallsByRequestKey = new Map<string, HttpCallRecord[]>();

export function runWithSupabaseHttpPerfScope<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return layoutHttpPerfStorage.run({ calls: [] }, fn);
}

export function beginLayoutHttpPerfProbe(requestKey: string): void {
  if (!layoutProbeCallsByRequestKey.has(requestKey)) {
    layoutProbeCallsByRequestKey.set(requestKey, []);
  }
}

export function peekLayoutHttpPerfSnapshot(
  requestKey: string,
): SupabaseHttpPerfSnapshot | null {
  const calls = layoutProbeCallsByRequestKey.get(requestKey);
  if (!calls || calls.length === 0) {
    return null;
  }
  return snapshotFromCalls([...calls]);
}

export function consumeLayoutHttpPerfSnapshot(
  requestKey: string,
): SupabaseHttpPerfSnapshot | null {
  const snap = peekLayoutHttpPerfSnapshot(requestKey);
  layoutProbeCallsByRequestKey.delete(requestKey);
  return snap;
}

export function mergeSupabaseHttpPerfSnapshots(
  ...snapshots: Array<SupabaseHttpPerfSnapshot | null>
): SupabaseHttpPerfSnapshot | null {
  const merged: HttpCallRecord[] = [];
  for (const snap of snapshots) {
    if (!snap || snap.calls.length === 0) {
      continue;
    }
    merged.push(...snap.calls);
  }
  if (merged.length === 0) {
    return null;
  }
  return snapshotFromCalls(merged);
}

function recordLayoutProbeCall(requestKey: string, call: HttpCallRecord): void {
  let bucket = layoutProbeCallsByRequestKey.get(requestKey);
  if (!bucket) {
    bucket = [];
    layoutProbeCallsByRequestKey.set(requestKey, bucket);
  }
  bucket.push(call);
}

export async function getLayoutProbeRequestKey(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    if (h.get(DFOMS_PERF_LAYOUT_PROBE_HEADER) !== "1") {
      return null;
    }
    return (
      h.get("x-vercel-id")?.trim() ||
      h.get("x-request-id")?.trim() ||
      "local"
    );
  } catch {
    return null;
  }
}

async function resolveLayoutProbeRequestKey(): Promise<string | null> {
  return getLayoutProbeRequestKey();
}

export type SupabaseHttpPerfSnapshot = {
  callCount: number;
  totalMs: number;
  slowest: HttpCallRecord[];
  calls: HttpCallRecord[];
};

function snapshotFromCalls(calls: HttpCallRecord[]): SupabaseHttpPerfSnapshot {
  const totalMs = calls.reduce((sum, c) => sum + c.ms, 0);
  const slowest = [...calls].sort((a, b) => b.ms - a.ms).slice(0, 3);
  return {
    callCount: calls.length,
    totalMs,
    slowest,
    calls,
  };
}

export function getSupabaseHttpPerfSnapshot(): SupabaseHttpPerfSnapshot | null {
  const store = layoutHttpPerfStorage.getStore();
  if (!store || store.calls.length === 0) {
    return null;
  }
  return snapshotFromCalls(store.calls);
}

export function labelSupabaseHttpRequest(input: RequestInfo | URL): string {
  try {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const u = new URL(href);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "rest" && parts[1] === "v1") {
      const table = parts[2]?.split("?")[0] ?? "?";
      return `rest:${table}`;
    }
    if (parts[0] === "auth") {
      const tail = parts.slice(2).join("/") || "root";
      return `auth:${tail}`;
    }
    if (parts[0] === "storage") {
      return `storage:${parts.slice(2, 5).join("/") || "object"}`;
    }
    const compact = u.pathname.replace(/^\/+/, "").slice(0, 48);
    return compact || "http";
  } catch {
    return "http";
  }
}

const instrumentedFetchByBase = new WeakMap<typeof fetch, typeof fetch>();

export function getSupabaseInstrumentedFetch(baseFetch: typeof fetch): typeof fetch {
  if (!isPerfProbeEnabled()) {
    return baseFetch;
  }
  let wrapped = instrumentedFetchByBase.get(baseFetch);
  if (!wrapped) {
    wrapped = wrapFetchForSupabaseHttpPerf(baseFetch);
    instrumentedFetchByBase.set(baseFetch, wrapped);
  }
  return wrapped;
}

export function wrapFetchForSupabaseHttpPerf(
  baseFetch: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    if (!isPerfProbeEnabled()) {
      return baseFetch(input, init);
    }
    const startedAt = Date.now();
    const response = await baseFetch(input, init);
    const ms = Date.now() - startedAt;
    const call: HttpCallRecord = {
      label: labelSupabaseHttpRequest(input),
      ms,
    };
    const store = layoutHttpPerfStorage.getStore();
    if (store) {
      store.calls.push(call);
    } else {
      try {
        const requestKey = await resolveLayoutProbeRequestKey();
        if (requestKey) {
          recordLayoutProbeCall(requestKey, call);
        }
      } catch {
        // Outside RSC / route handler (e.g. static analysis).
      }
    }
    return response;
  };
}

function supabaseHealthUrl(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!base) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  return `${base}/auth/v1/health`;
}

/** Two sequential GETs to auth health — cold then warm on the same runtime fetch pool. */
export async function measureSupabaseHealthRttTwice(): Promise<{
  rtt1Ms: number;
  rtt2Ms: number;
}> {
  const url = supabaseHealthUrl();
  const probeFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, cache: "no-store" });

  const rtt1Started = Date.now();
  await probeFetch(url, { method: "GET" });
  const rtt1Ms = Date.now() - rtt1Started;

  const rtt2Started = Date.now();
  await probeFetch(url, { method: "GET" });
  const rtt2Ms = Date.now() - rtt2Started;

  return { rtt1Ms, rtt2Ms };
}

export function formatLayoutPerfMetaContent(options: {
  renderMs: number;
  snapshot: SupabaseHttpPerfSnapshot;
}): string {
  const { renderMs, snapshot } = options;
  const slowParts = snapshot.slowest.map((c) => `${c.label}@${c.ms}`);
  while (slowParts.length < 3) {
    slowParts.push("-@0");
  }
  return [
    `ms=${renderMs}`,
    `calls=${snapshot.callCount}`,
    `supabaseMs=${snapshot.totalMs}`,
    `slow1=${slowParts[0]}`,
    `slow2=${slowParts[1]}`,
    `slow3=${slowParts[2]}`,
  ].join(";");
}
