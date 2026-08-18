import type { SystemEventStatus } from "@/utils/system-event-log-types";

/** Cron runs daily at 04:00 UTC — treat older results as stale for UI copy. */
export const BS_INTEGRITY_STALE_MS = 24 * 60 * 60 * 1000;

export type TenantBalanceSheetIntegrityImbalance = {
  monthIndex: number;
  monthLabel: string;
  diff: number;
};

export type TenantBalanceSheetIntegrityStatus = {
  imbalancedMonthCount: number;
  worstDiff: number;
  worstMonthLabel: string | null;
  worstMonthIndex: number | null;
  imbalances: TenantBalanceSheetIntegrityImbalance[];
  fiscalYear: number | null;
  checkedAt: string | null;
  isStale: boolean;
  /** Latest cron row status for this tenant, or null when no cron row exists yet. */
  cronStatus: SystemEventStatus | null;
  hasCronResult: boolean;
};

type TenantEventMetadata = {
  kind?: string;
  tenantId?: string;
  fiscalYear?: number;
  imbalances?: TenantBalanceSheetIntegrityImbalance[];
  maxAbsDiff?: number;
};

function roundCurrency(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseTenantMetadata(
  metadata: Record<string, unknown> | null,
): TenantEventMetadata {
  if (!metadata || metadata.kind === "run-summary") {
    return {};
  }

  const imbalances: TenantBalanceSheetIntegrityImbalance[] = Array.isArray(
    metadata.imbalances,
  )
    ? metadata.imbalances
        .filter(
          (row): row is { monthIndex: number; monthLabel: string; diff: number } =>
            typeof row === "object" &&
            row !== null &&
            typeof (row as { monthIndex?: unknown }).monthIndex === "number" &&
            typeof (row as { monthLabel?: unknown }).monthLabel === "string" &&
            typeof (row as { diff?: unknown }).diff === "number",
        )
        .map((row) => ({
          monthIndex: row.monthIndex,
          monthLabel: row.monthLabel,
          diff: roundCurrency(row.diff),
        }))
    : [];

  return {
    kind: typeof metadata.kind === "string" ? metadata.kind : undefined,
    tenantId: typeof metadata.tenantId === "string" ? metadata.tenantId : undefined,
    fiscalYear:
      typeof metadata.fiscalYear === "number" ? metadata.fiscalYear : undefined,
    imbalances,
    maxAbsDiff:
      typeof metadata.maxAbsDiff === "number"
        ? roundCurrency(metadata.maxAbsDiff)
        : undefined,
  };
}

function pickWorstImbalance(
  imbalances: TenantBalanceSheetIntegrityImbalance[],
): TenantBalanceSheetIntegrityImbalance | null {
  if (imbalances.length === 0) {
    return null;
  }

  return imbalances.reduce((worst, row) =>
    Math.abs(row.diff) > Math.abs(worst.diff) ? row : worst,
  );
}

export function buildTenantBalanceSheetIntegrityStatusFromMetadata(input: {
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  cronStatus: SystemEventStatus | null;
  referenceDate?: Date;
}): TenantBalanceSheetIntegrityStatus {
  const parsed = parseTenantMetadata(input.metadata);
  const imbalances = parsed.imbalances ?? [];
  const worst = pickWorstImbalance(imbalances);
  const checkedAt = input.createdAt;
  const referenceMs = (input.referenceDate ?? new Date()).getTime();
  const isStale =
    checkedAt === null ||
    referenceMs - new Date(checkedAt).getTime() > BS_INTEGRITY_STALE_MS;

  return {
    imbalancedMonthCount: imbalances.length,
    worstDiff: worst ? Math.abs(worst.diff) : roundCurrency(parsed.maxAbsDiff ?? 0),
    worstMonthLabel: worst?.monthLabel ?? null,
    worstMonthIndex: worst?.monthIndex ?? null,
    imbalances,
    fiscalYear: parsed.fiscalYear ?? null,
    checkedAt,
    isStale,
    cronStatus: input.cronStatus,
    hasCronResult: checkedAt !== null,
  };
}

export function emptyTenantBalanceSheetIntegrityStatus(): TenantBalanceSheetIntegrityStatus {
  return {
    imbalancedMonthCount: 0,
    worstDiff: 0,
    worstMonthLabel: null,
    worstMonthIndex: null,
    imbalances: [],
    fiscalYear: null,
    checkedAt: null,
    isStale: true,
    cronStatus: null,
    hasCronResult: false,
  };
}
