import {
  DASHBOARD_SUMMARY_TTL_MS,
  REFERENCE_LOOKUPS_TTL_MS,
} from "@/lib/client-cache/constants";
import {
  deleteCacheEntry,
  readCacheEntry,
  writeCacheEntry,
} from "@/lib/client-cache/idb-store";
import {
  buildDashboardSummaryCacheKey,
  buildReferenceLookupsCacheKey,
  type ClientCacheSession,
} from "@/lib/client-cache/keys";
import type {
  DashboardSummaryCachePayload,
  ReferenceLookupsPayload,
} from "@/lib/client-cache/types";

export async function getCachedDashboardSummary(
  session: ClientCacheSession,
): Promise<{
  payload: DashboardSummaryCachePayload;
  cachedAt: string;
} | null> {
  const key = buildDashboardSummaryCacheKey(session);
  const entry = await readCacheEntry<DashboardSummaryCachePayload>(key, session);
  if (!entry) {
    return null;
  }
  return { payload: entry.payload, cachedAt: entry.cachedAt };
}

export async function setCachedDashboardSummary(
  session: ClientCacheSession,
  payload: DashboardSummaryCachePayload,
): Promise<string> {
  const key = buildDashboardSummaryCacheKey(session);
  const envelope = await writeCacheEntry(
    key,
    session,
    payload,
    DASHBOARD_SUMMARY_TTL_MS,
  );
  return envelope.cachedAt;
}

export async function invalidateDashboardSummaryCache(
  session: ClientCacheSession,
): Promise<void> {
  await deleteCacheEntry(buildDashboardSummaryCacheKey(session));
}

export async function getCachedReferenceLookups(
  session: ClientCacheSession,
): Promise<{
  payload: ReferenceLookupsPayload;
  cachedAt: string;
} | null> {
  const key = buildReferenceLookupsCacheKey(session);
  const entry = await readCacheEntry<ReferenceLookupsPayload>(key, session);
  if (!entry) {
    return null;
  }
  return { payload: entry.payload, cachedAt: entry.cachedAt };
}

export async function setCachedReferenceLookups(
  session: ClientCacheSession,
  payload: ReferenceLookupsPayload,
): Promise<string> {
  const key = buildReferenceLookupsCacheKey(session);
  const envelope = await writeCacheEntry(
    key,
    session,
    payload,
    REFERENCE_LOOKUPS_TTL_MS,
  );
  return envelope.cachedAt;
}

export async function invalidateReferenceLookupsCache(
  session: ClientCacheSession,
): Promise<void> {
  await deleteCacheEntry(buildReferenceLookupsCacheKey(session));
}

/** After any reference-table write in admin screens. */
export async function invalidateReferenceLookupsAfterWrite(
  session: ClientCacheSession,
): Promise<void> {
  await invalidateReferenceLookupsCache(session);
}

/** After financial writes that affect dashboard widget numbers. */
export async function invalidateDashboardAfterFinancialWrite(
  session: ClientCacheSession,
): Promise<void> {
  await invalidateDashboardSummaryCache(session);
}
