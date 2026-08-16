import { CLIENT_CACHE_PURGE_MESSAGE } from "@/lib/client-cache/constants";
import { deleteClientCacheDatabase } from "@/lib/client-cache/idb-store";

/** Purge all IndexedDB client cache entries (main thread). */
export async function purgeClientCacheMainThread(): Promise<void> {
  await deleteClientCacheDatabase();
}

/** Ask the service worker to purge IndexedDB too (shared origin DB). */
export async function requestServiceWorkerCachePurge(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: CLIENT_CACHE_PURGE_MESSAGE });
  } catch {
    // Non-fatal — main-thread purge already ran.
  }
}

/** Full purge: main thread + service worker coordination. */
export async function purgeAllClientCache(): Promise<void> {
  await purgeClientCacheMainThread();
  await requestServiceWorkerCachePurge();
}
