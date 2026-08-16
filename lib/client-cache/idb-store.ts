import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  CLIENT_CACHE_DB_NAME,
  CLIENT_CACHE_OBJECT_STORE,
} from "@/lib/client-cache/constants";
import type { CacheEnvelope } from "@/lib/client-cache/types";

interface ClientCacheDbSchema extends DBSchema {
  entries: {
    key: string;
    value: CacheEnvelope<unknown>;
  };
}

let dbPromise: Promise<IDBPDatabase<ClientCacheDbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<ClientCacheDbSchema>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available."));
  }

  if (!dbPromise) {
    dbPromise = openDB<ClientCacheDbSchema>(CLIENT_CACHE_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CLIENT_CACHE_OBJECT_STORE)) {
          db.createObjectStore(CLIENT_CACHE_OBJECT_STORE);
        }
      },
    });
  }

  return dbPromise;
}

export async function readCacheEntry<T>(
  key: string,
  session: { tenantId: string; authUid: string },
): Promise<CacheEnvelope<T> | null> {
  const db = await getDb();
  const entry = (await db.get(CLIENT_CACHE_OBJECT_STORE, key)) as
    | CacheEnvelope<T>
    | undefined;

  if (!entry) {
    return null;
  }

  if (
    entry.tenantId !== session.tenantId ||
    entry.authUid !== session.authUid
  ) {
    await db.delete(CLIENT_CACHE_OBJECT_STORE, key);
    return null;
  }

  if (Date.now() > Date.parse(entry.expiresAt)) {
    await db.delete(CLIENT_CACHE_OBJECT_STORE, key);
    return null;
  }

  return entry;
}

export async function writeCacheEntry<T>(
  key: string,
  session: { tenantId: string; authUid: string },
  payload: T,
  ttlMs: number,
): Promise<CacheEnvelope<T>> {
  const db = await getDb();
  const now = Date.now();
  const envelope: CacheEnvelope<T> = {
    cachedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    tenantId: session.tenantId,
    authUid: session.authUid,
    payload,
  };

  await db.put(CLIENT_CACHE_OBJECT_STORE, envelope as CacheEnvelope<unknown>, key);
  return envelope;
}

export async function deleteCacheEntry(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(CLIENT_CACHE_OBJECT_STORE, key);
}

export async function deleteCacheEntriesByPrefix(prefix: string): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(CLIENT_CACHE_OBJECT_STORE, "readwrite");
  const store = tx.objectStore(CLIENT_CACHE_OBJECT_STORE);
  let deleted = 0;

  for await (const cursor of store.iterate()) {
    if (cursor.key.startsWith(prefix)) {
      await cursor.delete();
      deleted += 1;
    }
  }

  await tx.done;
  return deleted;
}

/** Deletes the entire client cache database (logout / tenant switch). */
export async function deleteClientCacheDatabase(): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }

  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // Non-fatal — proceed with deleteDatabase.
    }
    dbPromise = null;
  }

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CLIENT_CACHE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("deleteDatabase failed"));
    request.onblocked = () => resolve();
  });
}

export async function listCacheKeys(): Promise<string[]> {
  const db = await getDb();
  return db.getAllKeys(CLIENT_CACHE_OBJECT_STORE);
}
