import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentFinancialYear } from "@/app/dashboard/finance/finance-year-utils";
import { logTenantBalanceSheetIntegrityResult } from "@/utils/balance-sheet-integrity-cron";
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

function roundCurrency(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function buildStatusFromAuditResult(
  result: TenantBalanceSheetIntegrityResult,
  checkedAt: Date,
  options: { isLiveCheck?: boolean; hasCronResult?: boolean } = {},
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
    hasCronResult: options.hasCronResult ?? false,
    isLiveCheck: options.isLiveCheck ?? false,
    orphanApAccrualCount: result.orphanApAccrualCount,
  };
}

async function loadLatestLoggedTenantIntegrity(
  admin: SupabaseClient,
  tenantId: string,
  referenceDate: Date,
): Promise<TenantBalanceSheetIntegrityStatus | null> {
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
    return null;
  }

  return buildTenantBalanceSheetIntegrityStatusFromMetadata({
    metadata: (data.metadata as Record<string, unknown> | null) ?? null,
    createdAt: data.created_at,
    cronStatus: data.status as SystemEventStatus,
    referenceDate,
  });
}

async function runLiveTenantBalanceSheetIntegrityAudit(
  tenantId: string,
  options: {
    admin?: SupabaseClient;
    referenceDate?: Date;
    persist?: boolean;
    logSource?: "cron" | "live-check";
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

  if (options.persist) {
    await logTenantBalanceSheetIntegrityResult(result, {
      referenceDateIso: referenceDate.toISOString().slice(0, 10),
      source: options.logSource ?? "live-check",
    });
  }

  return buildStatusFromAuditResult(result, referenceDate, {
    isLiveCheck: options.persist ? false : true,
    hasCronResult: Boolean(options.persist),
  });
}

/**
 * Latest balance-sheet-integrity result for one tenant.
 * When the logged result is older than 24 hours, runs a live audit instead.
 */
export async function fetchTenantBalanceSheetIntegrityStatus(
  tenantId: string,
  options: {
    admin?: SupabaseClient;
    referenceDate?: Date;
  } = {},
): Promise<TenantBalanceSheetIntegrityStatus> {
  const admin = options.admin ?? createAdminClient();
  const referenceDate = options.referenceDate ?? new Date();

  const logged = await loadLatestLoggedTenantIntegrity(
    admin,
    tenantId,
    referenceDate,
  );

  if (!logged) {
    return runLiveTenantBalanceSheetIntegrityAudit(tenantId, {
      admin,
      referenceDate,
      persist: false,
    });
  }

  if (logged.isStale) {
    return runLiveTenantBalanceSheetIntegrityAudit(tenantId, {
      admin,
      referenceDate,
      persist: false,
    });
  }

  return logged;
}

/**
 * On-demand live BS audit for one tenant. Optionally persists to system_event_log.
 */
export async function runLiveTenantBalanceSheetIntegrityCheck(
  tenantId: string,
  options: {
    admin?: SupabaseClient;
    referenceDate?: Date;
    persist?: boolean;
  } = {},
): Promise<TenantBalanceSheetIntegrityStatus> {
  return runLiveTenantBalanceSheetIntegrityAudit(tenantId, {
    ...options,
    persist: options.persist ?? false,
    logSource: "live-check",
  });
}
