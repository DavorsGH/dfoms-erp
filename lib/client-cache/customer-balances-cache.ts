import { CUSTOMER_BALANCES_TTL_MS } from "@/lib/client-cache/constants";
import {
  deleteCacheEntry,
  readCacheEntry,
  writeCacheEntry,
} from "@/lib/client-cache/idb-store";
import {
  buildCustomerBalancesCacheKey,
  type ClientCacheSession,
} from "@/lib/client-cache/keys";
import type { CustomerBalancesCachePayload } from "@/lib/client-cache/types";

export async function getCachedCustomerBalances(
  session: ClientCacheSession,
): Promise<{
  payload: CustomerBalancesCachePayload;
  cachedAt: string;
} | null> {
  const key = buildCustomerBalancesCacheKey(session);
  const entry = await readCacheEntry<CustomerBalancesCachePayload>(
    key,
    session,
  );
  if (!entry) {
    return null;
  }
  return { payload: entry.payload, cachedAt: entry.cachedAt };
}

export async function setCachedCustomerBalances(
  session: ClientCacheSession,
  payload: CustomerBalancesCachePayload,
): Promise<string> {
  const key = buildCustomerBalancesCacheKey(session);
  const envelope = await writeCacheEntry(
    key,
    session,
    payload,
    CUSTOMER_BALANCES_TTL_MS,
  );
  return envelope.cachedAt;
}

export async function invalidateCustomerBalancesCache(
  session: ClientCacheSession,
): Promise<void> {
  await deleteCacheEntry(buildCustomerBalancesCacheKey(session));
}
