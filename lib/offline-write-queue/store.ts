import { WRITE_QUEUE_OBJECT_STORE } from "@/lib/client-cache/constants";
import { getClientCacheDb } from "@/lib/client-cache/idb-store";
import type { ClientCacheSession } from "@/lib/client-cache/keys";
import {
  buildWriteQueueSessionKey,
  type AttendanceQueuePayload,
  type ExpenseQueuePayload,
  type OfflineWriteQueueItem,
  type OfflineWriteQueueStatus,
  type OfflineWriteQueueType,
  type PosCashSaleQueuePayload,
} from "@/lib/offline-write-queue/types";

function assertBrowser(): void {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available.");
  }
}

export async function enqueueWriteQueueItem(input: {
  session: ClientCacheSession;
  type: OfflineWriteQueueType;
  payload:
    | AttendanceQueuePayload
    | ExpenseQueuePayload
    | PosCashSaleQueuePayload;
  id?: string;
}): Promise<OfflineWriteQueueItem> {
  assertBrowser();
  const db = await getClientCacheDb();
  const id = input.id ?? crypto.randomUUID();
  const item: OfflineWriteQueueItem = {
    id,
    type: input.type,
    payload: input.payload,
    tenantId: input.session.tenantId,
    authUid: input.session.authUid,
    sessionKey: buildWriteQueueSessionKey(
      input.session.tenantId,
      input.session.authUid,
    ),
    createdAt: new Date().toISOString(),
    status: "pending",
    retryCount: 0,
    lastError: null,
    syncedAt: null,
    notificationSent: false,
  };
  await db.put(WRITE_QUEUE_OBJECT_STORE, item);
  return item;
}

export async function listWriteQueueForSession(
  session: ClientCacheSession,
  options?: { includeSynced?: boolean },
): Promise<OfflineWriteQueueItem[]> {
  assertBrowser();
  const db = await getClientCacheDb();
  const sessionKey = buildWriteQueueSessionKey(
    session.tenantId,
    session.authUid,
  );
  const rows = await db.getAllFromIndex(
    WRITE_QUEUE_OBJECT_STORE,
    "by-session",
    sessionKey,
  );
  const filtered = options?.includeSynced
    ? rows
    : rows.filter((row) => row.status !== "synced");
  return filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getWriteQueueItem(
  id: string,
): Promise<OfflineWriteQueueItem | null> {
  assertBrowser();
  const db = await getClientCacheDb();
  return (await db.get(WRITE_QUEUE_OBJECT_STORE, id)) ?? null;
}

export async function updateWriteQueueItem(
  id: string,
  patch: Partial<
    Pick<
      OfflineWriteQueueItem,
      | "status"
      | "retryCount"
      | "lastError"
      | "syncedAt"
      | "notificationSent"
      | "payload"
    >
  >,
): Promise<OfflineWriteQueueItem | null> {
  assertBrowser();
  const db = await getClientCacheDb();
  const existing = await db.get(WRITE_QUEUE_OBJECT_STORE, id);
  if (!existing) {
    return null;
  }
  const next: OfflineWriteQueueItem = { ...existing, ...patch };
  await db.put(WRITE_QUEUE_OBJECT_STORE, next);
  return next;
}

export async function deleteWriteQueueItem(id: string): Promise<void> {
  assertBrowser();
  const db = await getClientCacheDb();
  await db.delete(WRITE_QUEUE_OBJECT_STORE, id);
}

export async function countOpenWriteQueueItems(
  session: ClientCacheSession,
): Promise<{
  pending: number;
  failed: number;
  syncing: number;
  conflict: number;
}> {
  const items = await listWriteQueueForSession(session);
  const counts = { pending: 0, failed: 0, syncing: 0, conflict: 0 };
  for (const item of items) {
    if (item.status === "pending") counts.pending += 1;
    else if (item.status === "failed") counts.failed += 1;
    else if (item.status === "syncing") counts.syncing += 1;
    else if (item.status === "conflict") counts.conflict += 1;
  }
  return counts;
}

export async function listDrainableWriteQueueItems(
  session: ClientCacheSession,
): Promise<OfflineWriteQueueItem[]> {
  const items = await listWriteQueueForSession(session);
  return items.filter(
    (item) => item.status === "pending" || item.status === "failed",
  );
}

export function isOpenQueueStatus(status: OfflineWriteQueueStatus): boolean {
  return (
    status === "pending" ||
    status === "failed" ||
    status === "syncing" ||
    status === "conflict"
  );
}
