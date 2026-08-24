import {
  STOCK_LEVELS_TTL_MS,
} from "@/lib/client-cache/constants";
import {
  deleteCacheEntry,
  readCacheEntry,
  writeCacheEntry,
} from "@/lib/client-cache/idb-store";
import {
  buildStockLevelsCacheKey,
  type ClientCacheSession,
} from "@/lib/client-cache/keys";
import type { StockLevelsCachePayload } from "@/lib/client-cache/types";

export async function getCachedStockLevels(
  session: ClientCacheSession,
): Promise<{
  payload: StockLevelsCachePayload;
  cachedAt: string;
} | null> {
  const key = buildStockLevelsCacheKey(session);
  const entry = await readCacheEntry<StockLevelsCachePayload>(key, session);
  if (!entry) {
    return null;
  }
  return { payload: entry.payload, cachedAt: entry.cachedAt };
}

export async function setCachedStockLevels(
  session: ClientCacheSession,
  payload: StockLevelsCachePayload,
): Promise<string> {
  const key = buildStockLevelsCacheKey(session);
  const envelope = await writeCacheEntry(
    key,
    session,
    payload,
    STOCK_LEVELS_TTL_MS,
  );
  return envelope.cachedAt;
}

export async function invalidateStockLevelsCache(
  session: ClientCacheSession,
): Promise<void> {
  await deleteCacheEntry(buildStockLevelsCacheKey(session));
}
