import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BS_INTEGRITY_EVENT_NAME,
} from "@/utils/balance-sheet-integrity-constants";
import type { SystemEventStatus } from "@/utils/system-event-log-types";

export type BalanceSheetIntegritySummaryRow = {
  tenantId: string;
  tenantName: string;
  status: SystemEventStatus;
  message: string | null;
  maxAbsDiff: number;
  imbalances: Array<{
    monthLabel: string;
    diff: number;
  }>;
  checkedAt: string;
  runId: string | null;
};

type TenantEventMetadata = {
  kind?: string;
  tenantId?: string;
  tenantName?: string;
  maxAbsDiff?: number;
  imbalances?: Array<{ monthLabel: string; diff: number }>;
  runId?: string;
};

function parseTenantMetadata(
  metadata: Record<string, unknown> | null,
): TenantEventMetadata {
  if (!metadata || metadata.kind === "run-summary") {
    return {};
  }

  return {
    kind: typeof metadata.kind === "string" ? metadata.kind : undefined,
    tenantId: typeof metadata.tenantId === "string" ? metadata.tenantId : undefined,
    tenantName:
      typeof metadata.tenantName === "string" ? metadata.tenantName : undefined,
    maxAbsDiff:
      typeof metadata.maxAbsDiff === "number" ? metadata.maxAbsDiff : undefined,
    imbalances: Array.isArray(metadata.imbalances)
      ? metadata.imbalances
          .filter(
            (row): row is { monthLabel: string; diff: number } =>
              typeof row === "object" &&
              row !== null &&
              typeof (row as { monthLabel?: unknown }).monthLabel === "string" &&
              typeof (row as { diff?: unknown }).diff === "number",
          )
          .map((row) => ({
            monthLabel: row.monthLabel,
            diff: row.diff,
          }))
      : [],
    runId: typeof metadata.runId === "string" ? metadata.runId : undefined,
  };
}

/**
 * Latest balance-sheet-integrity result per tenant (failure/warning only).
 */
export async function fetchBalanceSheetIntegritySummary(
  admin: SupabaseClient,
): Promise<BalanceSheetIntegritySummaryRow[]> {
  const { data, error } = await admin
    .from("system_event_log")
    .select("status, message, metadata, created_at")
    .eq("event_name", BS_INTEGRITY_EVENT_NAME)
    .order("created_at", { ascending: false })
    .limit(250);

  if (error || !data) {
    return [];
  }

  const latestByTenant = new Map<string, BalanceSheetIntegritySummaryRow>();

  for (const row of data) {
    const metadata = parseTenantMetadata(
      (row.metadata as Record<string, unknown> | null) ?? null,
    );
    if (!metadata.tenantId || metadata.kind === "run-summary") {
      continue;
    }

    if (latestByTenant.has(metadata.tenantId)) {
      continue;
    }

    if (row.status !== "failure" && row.status !== "warning") {
      continue;
    }

    latestByTenant.set(metadata.tenantId, {
      tenantId: metadata.tenantId,
      tenantName: metadata.tenantName ?? metadata.tenantId,
      status: row.status as SystemEventStatus,
      message: row.message,
      maxAbsDiff: metadata.maxAbsDiff ?? 0,
      imbalances: metadata.imbalances ?? [],
      checkedAt: row.created_at,
      runId: metadata.runId ?? null,
    });
  }

  return Array.from(latestByTenant.values()).sort((left, right) =>
    left.tenantName.localeCompare(right.tenantName),
  );
}
