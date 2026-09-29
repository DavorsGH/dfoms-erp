"use client";

import { purgeAllClientCache } from "@/lib/client-cache/purge";

/** Purge IndexedDB client cache (non-blocking after POST /api/auth/sign-out). */
export async function purgeClientCacheBeforeSignOut(): Promise<void> {
  await purgeAllClientCache();
}
