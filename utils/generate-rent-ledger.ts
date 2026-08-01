import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";

export type GenerateRentLedgerOptions = {
  /** Billing month as YYYY-MM. Defaults to the current UTC month. */
  billingMonth?: string;
  /** Optional clock override for overdue checks (ISO date or Date). */
  asOf?: Date | string;
  admin?: SupabaseClient;
  /**
   * Optional landlord tenant scope. When omitted, all active leases are
   * processed (cron / platform-wide path).
   */
  tenantId?: string;
  /** Optional single-lease scope (still requires the lease to be active). */
  leaseId?: string;
};

export type RentLedgerLeaseResult = {
  leaseId: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  amountDueGhs: number;
  skipped: boolean;
  skipReason?: string;
  escalationApplied: boolean;
  previousRentGhs?: number;
  newRentGhs?: number;
  lateFeeApplied: boolean;
  lateFeeGhs?: number;
  entryId?: string;
  error?: string;
};

export type GenerateRentLedgerResult = {
  billingMonth: string;
  periodStart: string;
  periodEnd: string;
  asOfDate: string;
  overdueUpdated: number;
  created: number;
  skipped: number;
  errors: number;
  leases: RentLedgerLeaseResult[];
};

type ActiveLeaseRow = {
  tenant_id: string;
  lease_id: string;
  start_date: string;
  end_date: string;
  rent_amount_ghs: number | string;
  escalation_percent: number | string | null;
  escalation_frequency_months: number | null;
  late_fee_enabled: boolean;
  late_fee_type: string | null;
  late_fee_amount: number | string | null;
};

type LedgerPeriodRow = {
  entry_id: string;
  lease_id: string;
  period_start: string;
  status: string;
};

function parseBillingMonth(value: string | undefined): {
  year: number;
  monthIndex: number;
} {
  if (value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
    if (!match) {
      throw new Error("billingMonth must be YYYY-MM");
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || month < 1 || month > 12) {
      throw new Error("billingMonth must be a valid YYYY-MM");
    }
    return { year, monthIndex: month - 1 };
  }

  const now = new Date();
  return { year: now.getUTCFullYear(), monthIndex: now.getUTCMonth() };
}

export function getMonthPeriodBounds(
  year: number,
  monthIndex: number,
): { periodStart: string; periodEnd: string } {
  const periodStart = new Date(Date.UTC(year, monthIndex, 1));
  const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    periodStart: toDateString(periodStart),
    periodEnd: toDateString(periodEnd),
  };
}

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Whole calendar months from lease start month to billing period start month.
 * Escalation applies when monthsElapsed > 0 and divisible by frequency.
 */
export function monthsBetweenYearMonths(
  startDate: string,
  periodStart: string,
): number {
  const start = parseDateOnly(startDate);
  const period = parseDateOnly(periodStart);
  return (
    (period.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (period.getUTCMonth() - start.getUTCMonth())
  );
}

export function isEscalationBoundary(
  startDate: string,
  periodStart: string,
  escalationFrequencyMonths: number,
): boolean {
  if (
    !Number.isInteger(escalationFrequencyMonths) ||
    escalationFrequencyMonths < 1
  ) {
    return false;
  }
  const elapsed = monthsBetweenYearMonths(startDate, periodStart);
  return elapsed > 0 && elapsed % escalationFrequencyMonths === 0;
}

function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid date: ${value}`);
  }
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function previousMonthPeriod(periodStart: string): {
  periodStart: string;
  periodEnd: string;
} {
  const current = parseDateOnly(periodStart);
  const year = current.getUTCFullYear();
  const monthIndex = current.getUTCMonth() - 1;
  return getMonthPeriodBounds(
    monthIndex < 0 ? year - 1 : year,
    monthIndex < 0 ? 11 : monthIndex,
  );
}

function resolveAsOfDate(asOf: Date | string | undefined): string {
  if (!asOf) {
    return toDateString(new Date());
  }
  if (typeof asOf === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return asOf;
    }
    return toDateString(new Date(asOf));
  }
  return toDateString(asOf);
}

/**
 * Platform-wide monthly rent ledger generation for all active leases.
 * Uses the service-role client (no request-scoped tenant).
 */
export async function generateRentLedger(
  options: GenerateRentLedgerOptions = {},
): Promise<GenerateRentLedgerResult> {
  const admin = options.admin ?? createAdminClient();
  const { year, monthIndex } = parseBillingMonth(options.billingMonth);
  const { periodStart, periodEnd } = getMonthPeriodBounds(year, monthIndex);
  const billingMonth = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const asOfDate = resolveAsOfDate(options.asOf);
  const previous = previousMonthPeriod(periodStart);

  const tenantId = options.tenantId?.trim() || undefined;
  const leaseId = options.leaseId?.trim() || undefined;

  console.log("[generate-rent-ledger] start", {
    billingMonth,
    periodStart,
    periodEnd,
    asOfDate,
    tenantId: tenantId ?? null,
    leaseId: leaseId ?? null,
  });

  let leasesQuery = admin
    .from("leases")
    .select(
      "tenant_id, lease_id, start_date, end_date, rent_amount_ghs, escalation_percent, escalation_frequency_months, late_fee_enabled, late_fee_type, late_fee_amount",
    )
    .eq("status", "active");

  if (tenantId) {
    leasesQuery = leasesQuery.eq("tenant_id", tenantId);
  }
  if (leaseId) {
    leasesQuery = leasesQuery.eq("lease_id", leaseId);
  }

  const { data: leases, error: leasesError } = await leasesQuery;

  if (leasesError) {
    throw new Error(`Failed to load active leases: ${leasesError.message}`);
  }

  const overdueUpdated = await markOverdueLedgerRows(admin, asOfDate, {
    tenantId,
    leaseId,
  });

  const activeLeases = (leases as ActiveLeaseRow[] | null) ?? [];
  const leaseResults: RentLedgerLeaseResult[] = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;

  // Prefetch existing rows for this period + previous-period overdue lookups.
  const leaseIds = activeLeases.map((lease) => lease.lease_id);
  const existingByLease = new Map<string, boolean>();
  const previousOverdueByLease = new Map<string, boolean>();

  if (leaseIds.length > 0) {
    const [{ data: existingRows, error: existingError }, { data: previousRows, error: previousError }] =
      await Promise.all([
        admin
          .from("rent_ledger")
          .select("lease_id, period_start")
          .eq("period_start", periodStart)
          .in("lease_id", leaseIds),
        admin
          .from("rent_ledger")
          .select("lease_id, period_start, status")
          .eq("period_start", previous.periodStart)
          .eq("status", "overdue")
          .in("lease_id", leaseIds),
      ]);

    if (existingError) {
      throw new Error(
        `Failed to load existing rent_ledger rows: ${existingError.message}`,
      );
    }
    if (previousError) {
      throw new Error(
        `Failed to load previous overdue rent_ledger rows: ${previousError.message}`,
      );
    }

    for (const row of (existingRows as Array<{ lease_id: string }> | null) ??
      []) {
      existingByLease.set(row.lease_id, true);
    }
    for (const row of (previousRows as LedgerPeriodRow[] | null) ?? []) {
      previousOverdueByLease.set(row.lease_id, true);
    }
  }

  for (const lease of activeLeases) {
    const result = await processActiveLease({
      admin,
      lease,
      periodStart,
      periodEnd,
      alreadyExists: existingByLease.get(lease.lease_id) === true,
      previousPeriodOverdue: previousOverdueByLease.get(lease.lease_id) === true,
    });

    leaseResults.push(result);

    if (result.error) {
      errors += 1;
      console.error("[generate-rent-ledger] lease error", result);
      continue;
    }

    if (result.skipped) {
      skipped += 1;
      console.log("[generate-rent-ledger] skipped", {
        lease_id: result.leaseId,
        period: result.periodStart,
        reason: result.skipReason,
      });
      continue;
    }

    created += 1;
    console.log("[generate-rent-ledger] created", {
      lease_id: result.leaseId,
      period: `${result.periodStart}..${result.periodEnd}`,
      amount_due: result.amountDueGhs,
      escalation_applied: result.escalationApplied,
      previous_rent: result.previousRentGhs,
      new_rent: result.newRentGhs,
      late_fee_applied: result.lateFeeApplied,
      late_fee_ghs: result.lateFeeGhs,
      entry_id: result.entryId,
    });
  }

  const summary: GenerateRentLedgerResult = {
    billingMonth,
    periodStart,
    periodEnd,
    asOfDate,
    overdueUpdated,
    created,
    skipped,
    errors,
    leases: leaseResults,
  };

  console.log("[generate-rent-ledger] complete", {
    billingMonth,
    overdueUpdated,
    created,
    skipped,
    errors,
  });

  return summary;
}

async function markOverdueLedgerRows(
  admin: SupabaseClient,
  asOfDate: string,
  scope?: { tenantId?: string; leaseId?: string },
): Promise<number> {
  const nowIso = new Date().toISOString();
  let query = admin
    .from("rent_ledger")
    .update({
      status: "overdue",
      updated_at: nowIso,
    })
    .lt("period_end", asOfDate)
    .in("status", ["pending", "partial"]);

  // Scoped Generate Now must not mark the whole platform overdue.
  if (scope?.tenantId) {
    query = query.eq("tenant_id", scope.tenantId);
  }
  if (scope?.leaseId) {
    query = query.eq("lease_id", scope.leaseId);
  }

  const { data, error } = await query.select("entry_id");

  if (error) {
    throw new Error(`Failed to mark overdue rent_ledger rows: ${error.message}`);
  }

  const count = (data ?? []).length;
  console.log("[generate-rent-ledger] marked overdue", {
    asOfDate,
    count,
    tenantId: scope?.tenantId ?? null,
    leaseId: scope?.leaseId ?? null,
  });
  return count;
}

async function processActiveLease(args: {
  admin: SupabaseClient;
  lease: ActiveLeaseRow;
  periodStart: string;
  periodEnd: string;
  alreadyExists: boolean;
  previousPeriodOverdue: boolean;
}): Promise<RentLedgerLeaseResult> {
  const { admin, lease, periodStart, periodEnd, alreadyExists, previousPeriodOverdue } =
    args;

  const baseResult: RentLedgerLeaseResult = {
    leaseId: lease.lease_id,
    tenantId: lease.tenant_id,
    periodStart,
    periodEnd,
    amountDueGhs: 0,
    skipped: false,
    escalationApplied: false,
    lateFeeApplied: false,
  };

  if (lease.start_date > periodEnd) {
    return {
      ...baseResult,
      skipped: true,
      skipReason: "lease_starts_after_period",
    };
  }

  if (lease.end_date < periodStart) {
    return {
      ...baseResult,
      skipped: true,
      skipReason: "lease_ended_before_period",
    };
  }

  if (alreadyExists) {
    return {
      ...baseResult,
      skipped: true,
      skipReason: "already_exists",
    };
  }

  let rentAmount = toNumber(lease.rent_amount_ghs) ?? 0;
  let escalationApplied = false;
  let previousRentGhs: number | undefined;
  let newRentGhs: number | undefined;

  const escalationPercent = toNumber(lease.escalation_percent);
  const escalationFrequency = lease.escalation_frequency_months;

  if (
    escalationPercent != null &&
    escalationPercent > 0 &&
    escalationFrequency != null &&
    isEscalationBoundary(lease.start_date, periodStart, escalationFrequency)
  ) {
    previousRentGhs = rentAmount;
    newRentGhs = roundMoney(rentAmount * (1 + escalationPercent / 100));
    const nowIso = new Date().toISOString();

    const { error: escalateError } = await admin
      .from("leases")
      .update({
        rent_amount_ghs: newRentGhs,
        updated_at: nowIso,
      })
      .eq("tenant_id", lease.tenant_id)
      .eq("lease_id", lease.lease_id)
      .eq("status", "active");

    if (escalateError) {
      return {
        ...baseResult,
        error: `Escalation update failed: ${escalateError.message}`,
      };
    }

    console.log("[generate-rent-ledger] escalation applied", {
      lease_id: lease.lease_id,
      period: periodStart,
      previous_rent_ghs: previousRentGhs,
      escalation_percent: escalationPercent,
      new_rent_ghs: newRentGhs,
    });

    rentAmount = newRentGhs;
    escalationApplied = true;
  }

  let amountDue = rentAmount;
  let lateFeeApplied = false;
  let lateFeeGhs: number | undefined;

  if (previousPeriodOverdue && lease.late_fee_enabled) {
    const lateFeeAmount = toNumber(lease.late_fee_amount);
    if (lateFeeAmount != null && lateFeeAmount >= 0) {
      if (lease.late_fee_type === "fixed") {
        lateFeeGhs = roundMoney(lateFeeAmount);
      } else if (lease.late_fee_type === "percent") {
        lateFeeGhs = roundMoney((rentAmount * lateFeeAmount) / 100);
      }

      if (lateFeeGhs != null && lateFeeGhs > 0) {
        amountDue = roundMoney(amountDue + lateFeeGhs);
        lateFeeApplied = true;
      }
    }
  }

  amountDue = roundMoney(amountDue);
  const entryId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const noteParts: string[] = [];
  if (escalationApplied && previousRentGhs != null && newRentGhs != null) {
    noteParts.push(
      `Automatic escalation applied: rent ${previousRentGhs} → ${newRentGhs} (${escalationPercent}%).`,
    );
  }
  if (lateFeeApplied && lateFeeGhs != null) {
    noteParts.push(
      `Late fee ${lateFeeGhs} added (previous period overdue, ${lease.late_fee_type}).`,
    );
  }

  const { error: insertError } = await admin.from("rent_ledger").insert({
    tenant_id: lease.tenant_id,
    entry_id: entryId,
    lease_id: lease.lease_id,
    period_start: periodStart,
    period_end: periodEnd,
    amount_due_ghs: amountDue,
    amount_paid_ghs: 0,
    credit_ghs: 0,
    status: "pending",
    verification_status: "not_required",
    notes: noteParts.length > 0 ? noteParts.join(" ") : null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    return {
      ...baseResult,
      amountDueGhs: amountDue,
      escalationApplied,
      previousRentGhs,
      newRentGhs,
      lateFeeApplied,
      lateFeeGhs,
      error: `Insert failed: ${insertError.message}`,
    };
  }

  return {
    ...baseResult,
    amountDueGhs: amountDue,
    escalationApplied,
    previousRentGhs,
    newRentGhs,
    lateFeeApplied,
    lateFeeGhs,
    entryId,
  };
}
