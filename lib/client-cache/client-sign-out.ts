"use client";

import { purgeAllClientCache } from "@/lib/client-cache/purge";

/** Call before server sign-out to prevent cross-tenant IndexedDB leakage. */
export async function purgeClientCacheBeforeSignOut(): Promise<void> {
  await purgeAllClientCache();
}
