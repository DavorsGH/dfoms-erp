import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { BS_INTEGRITY_EVENT_NAME } from "@/utils/balance-sheet-integrity-constants";
import type { SystemEventStatus } from "@/utils/system-event-log-types";
import {
  buildTenantBalanceSheetIntegrityStatusFromMetadata,
  emptyTenantBalanceSheetIntegrityStatus,
  type TenantBalanceSheetIntegrityStatus,
} from "@/utils/tenant-balance-sheet-integrity-status-core";

export type {
  TenantBalanceSheetIntegrityImbalance,
  TenantBalanceSheetIntegrityStatus,
} from "@/utils/tenant-balance-sheet-integrity-status-core";

export {
  BS_INTEGRITY_STALE_MS,
  buildTenantBalanceSheetIntegrityStatusFromMetadata,
  emptyTenantBalanceSheetIntegrityStatus,
} from "@/utils/tenant-balance-sheet-integrity-status-core";

/**
 * Latest nightly balance-sheet-integrity cron result for one tenant.
 * Uses admin client — caller must pass session-resolved tenantId only.
 */
export async function fetchTenantBalanceSheetIntegrityStatus(
  tenantId: string,
  options: {
    admin?: SupabaseClient;
    referenceDate?: Date;
  } = {},
): Promise<TenantBalanceSheetIntegrityStatus> {
  const admin = options.admin ?? createAdminClient();

  const { data, error } = await admin
    .from("system_event_log")
    .select("status, metadata, created_at")
    .eq("event_name", BS_INTEGRITY_EVENT_NAME)
    .filter("metadata->>kind", "eq", "tenant")
    .filter("metadata->>tenantId", "eq", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return emptyTenantBalanceSheetIntegrityStatus();
  }

  return buildTenantBalanceSheetIntegrityStatusFromMetadata({
    metadata: (data.metadata as Record<string, unknown> | null) ?? null,
    createdAt: data.created_at,
    cronStatus: data.status as SystemEventStatus,
    referenceDate: options.referenceDate,
  });
}
