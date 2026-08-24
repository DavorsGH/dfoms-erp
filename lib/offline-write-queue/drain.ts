import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientCacheSession } from "@/lib/client-cache/keys";
import { syncAttendanceQueueItem } from "@/lib/offline-write-queue/handlers/attendance";
import { syncExpenseQueueItem } from "@/lib/offline-write-queue/handlers/expense";
import {
  deleteWriteQueueItem,
  listDrainableWriteQueueItems,
  updateWriteQueueItem,
} from "@/lib/offline-write-queue/store";
import type {
  AttendanceQueuePayload,
  ExpenseQueuePayload,
  OfflineWriteQueueItem,
} from "@/lib/offline-write-queue/types";

export type DrainWriteQueueResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skippedDuplicates: number;
  errors: { id: string; type: string; error: string }[];
};

let drainInFlight: Promise<DrainWriteQueueResult> | null = null;

/**
 * Process pending/failed queue items in createdAt order.
 * Failures do not block later items.
 */
export async function drainWriteQueue(
  supabase: SupabaseClient,
  session: ClientCacheSession,
): Promise<DrainWriteQueueResult> {
  if (drainInFlight) {
    return drainInFlight;
  }

  drainInFlight = (async () => {
    const result: DrainWriteQueueResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skippedDuplicates: 0,
      errors: [],
    };

    const items = await listDrainableWriteQueueItems(session);

    for (const item of items) {
      result.processed += 1;
      await updateWriteQueueItem(item.id, {
        status: "syncing",
        lastError: null,
      });

      try {
        const syncResult = await syncOneItem(supabase, item);
        if (!syncResult.ok) {
          result.failed += 1;
          result.errors.push({
            id: item.id,
            type: item.type,
            error: syncResult.error,
          });
          await updateWriteQueueItem(item.id, {
            status: "failed",
            retryCount: item.retryCount + 1,
            lastError: syncResult.error,
          });
          continue;
        }

        if (syncResult.duplicateNaturalKey) {
          result.skippedDuplicates += 1;
        }

        result.succeeded += 1;
        await updateWriteQueueItem(item.id, {
          status: "synced",
          syncedAt: new Date().toISOString(),
          lastError: null,
          notificationSent: syncResult.notificationSent,
        });
        // Keep briefly then remove — UI already refreshed from live data.
        await deleteWriteQueueItem(item.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown sync error";
        result.failed += 1;
        result.errors.push({ id: item.id, type: item.type, error: message });
        await updateWriteQueueItem(item.id, {
          status: "failed",
          retryCount: item.retryCount + 1,
          lastError: message,
        });
      }
    }

    return result;
  })();

  try {
    return await drainInFlight;
  } finally {
    drainInFlight = null;
  }
}

async function syncOneItem(
  supabase: SupabaseClient,
  item: OfflineWriteQueueItem,
): Promise<
  | { ok: true; duplicateNaturalKey?: boolean; notificationSent?: boolean }
  | { ok: false; error: string }
> {
  if (item.type === "attendance") {
    const result = await syncAttendanceQueueItem(supabase, {
      clientOpId: item.id,
      tenantId: item.tenantId,
      payload: item.payload as AttendanceQueuePayload,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      duplicateNaturalKey: result.duplicateNaturalKey,
    };
  }

  if (item.type === "expense") {
    const result = await syncExpenseQueueItem(supabase, {
      clientOpId: item.id,
      tenantId: item.tenantId,
      payload: item.payload as ExpenseQueuePayload,
      notificationSent: Boolean(item.notificationSent),
    });
    if (!result.ok) return result;
    return { ok: true, notificationSent: result.notificationSent };
  }

  return { ok: false, error: `Unsupported queue type: ${item.type}` };
}
