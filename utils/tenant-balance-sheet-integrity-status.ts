import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentFinancialYear } from "@/app/dashboard/finance/finance-year-utils";
import { createAdminClient } from "@/utils/supabase/admin";
import { BS_INTEGRITY_EVENT_NAME } from "@/utils/balance-sheet-integrity-constants";
import {
  auditTenantBalanceSheetIntegrity,
  type TenantBalanceSheetIntegrityResult,
} from "@/utils/balance-sheet-integrity";
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

function roundCurrency(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function buildStatusFromAuditResult(
  result: TenantBalanceSheetIntegrityResult,
  checkedAt: Date,
): TenantBalanceSheetIntegrityStatus {
  const imbalances = result.imbalances.map((row) => ({
    monthIndex: row.monthIndex,
    monthLabel: row.monthLabel,
    diff: roundCurrency(row.diff),
  }));

  const worst =
    imbalances.length > 0
      ? imbalances.reduce((best, row) =>
          Math.abs(row.diff) > Math.abs(best.diff) ? row : best,
        )
      : null;

  return {
    imbalancedMonthCount: imbalances.length,
    worstDiff: worst ? Math.abs(worst.diff) : roundCurrency(result.maxAbsDiff),
    worstMonthLabel: worst?.monthLabel ?? null,
    worstMonthIndex: worst?.monthIndex ?? null,
    imbalances,
    fiscalYear: result.fiscalYear,
    checkedAt: checkedAt.toISOString(),
    isStale: false,
    cronStatus: result.status,
    hasCronResult: false,
    isLiveCheck: true,
  };
}

/**
 * On-demand live BS audit for one tenant. Does not write system_event_log.
 * Caller must pass session-resolved tenantId only.
 */
export async function runLiveTenantBalanceSheetIntegrityCheck(
  tenantId: string,
  options: {
    admin?: SupabaseClient;
    referenceDate?: Date;
  } = {},
): Promise<TenantBalanceSheetIntegrityStatus> {
  const admin = options.admin ?? createAdminClient();
  const referenceDate = options.referenceDate ?? new Date();
  const fiscalYear = getCurrentFinancialYear();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError) {
    throw new Error(tenantError.message);
  }
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  const result = await auditTenantBalanceSheetIntegrity(
    admin,
    { id: tenant.id, name: tenant.name },
    fiscalYear,
    referenceDate,
  );

  if (result.fetchError) {
    throw new Error(result.fetchError);
  }

  return buildStatusFromAuditResult(result, referenceDate);
}
