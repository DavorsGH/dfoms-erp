import type { SupabaseClient } from "@supabase/supabase-js";

import { toPeriodMonth } from "@/app/dashboard/finance/tax-utils";

export const PAYROLL_PERIOD_SOURCE_TYPE = "payroll_period" as const;

export type PayrollStatutoryComponent =
  | "paye"
  | "ssnit_employee"
  | "ssnit_employer_tier1"
  | "ssnit_tier2";

export type PayrollStatutoryLegAction =
  | "insert"
  | "update"
  | "unchanged"
  | "skipped_paid"
  | "delete";

export type PayrollStatutoryLegLog = {
  tax_component: PayrollStatutoryComponent;
  tax_amount: number;
  action: PayrollStatutoryLegAction;
};

export type PayrollStatutoryLedgerResult = {
  sourceId: string;
  inserted: number;
  updated: number;
  deleted: number;
  skippedPaid: number;
  unchanged: number;
  dryRun: boolean;
  legs: PayrollStatutoryLegLog[];
};

export type SyncPayrollPeriodTaxLedgerOptions = {
  /** When true, compute insert/update/delete decisions but do not write. */
  dryRun?: boolean;
};

type PayrollStatutorySourceRow = {
  gross_pay?: number | null;
  employee_ssnit?: number | null;
  employer_ssnit?: number | null;
  tier2?: number | null;
  paye_tax?: number | null;
};

type PayrollStatutoryPeriod = {
  payrollMonth: string;
  monthLabel: string;
  periodEndDate: string;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumField(
  rows: PayrollStatutorySourceRow[],
  field: keyof PayrollStatutorySourceRow,
): number {
  return roundCurrency(
    rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0),
  );
}

/**
 * source_id choice for payroll_period legs:
 *
 * `tax_ledger_entries.source_id` is uuid (script 113). month_end_close has no
 * stable uuid PK (unique on tenant_id + month). We therefore use a
 * deterministic UUID that encodes the payroll month date YYYY-MM-01 in the
 * node field: `a11ce000-0000-5000-8000-0000YYYYMMDD`.
 *
 * Tenant scope comes from the partial unique index
 * (tenant_id, source_type, source_id, direction, tax_component)
 * WHERE status <> 'reversed' AND source_id IS NOT NULL — so the same encoded
 * month UUID may be reused across tenants without collision.
 *
 * Stable across re-locks of the same payrollMonth; no dependency on
 * month_end_close row identity.
 */
export function buildPayrollPeriodTaxLedgerSourceId(
  payrollMonth: string,
): string {
  const ymd = payrollMonth.slice(0, 10).replaceAll("-", "");
  if (!/^\d{8}$/.test(ymd)) {
    throw new Error(
      `Invalid payroll month for tax ledger source_id: ${payrollMonth}`,
    );
  }

  return `a11ce000-0000-5000-8000-0000${ymd}`;
}

type ExistingStatutoryRow = {
  id: string;
  tax_component: PayrollStatutoryComponent;
  status: string;
  tax_amount: number;
};

type DesiredLeg = {
  tax_component: PayrollStatutoryComponent;
  tax_amount: number;
  counterparty_name: string;
};

function buildDesiredLegs(
  rows: PayrollStatutorySourceRow[],
): DesiredLeg[] {
  const paye = sumField(rows, "paye_tax");
  const employeeSsnit = sumField(rows, "employee_ssnit");
  const employerTier1 = sumField(rows, "employer_ssnit");
  const tier2 = sumField(rows, "tier2");

  const legs: DesiredLeg[] = [];

  if (paye > 0) {
    legs.push({
      tax_component: "paye",
      tax_amount: paye,
      counterparty_name: "GRA",
    });
  }
  if (employeeSsnit > 0) {
    legs.push({
      tax_component: "ssnit_employee",
      tax_amount: employeeSsnit,
      counterparty_name: "SSNIT",
    });
  }
  if (employerTier1 > 0) {
    legs.push({
      tax_component: "ssnit_employer_tier1",
      tax_amount: employerTier1,
      counterparty_name: "SSNIT",
    });
  }
  if (tier2 > 0) {
    legs.push({
      tax_component: "ssnit_tier2",
      tax_amount: tier2,
      counterparty_name: "SSNIT",
    });
  }

  return legs;
}

/**
 * Upsert period-aggregate statutory legs after payroll_history is written.
 *
 * Policy on re-lock:
 * - Update existing status='open' rows (amount / notes / dates).
 * - Insert missing non-zero components.
 * - Delete open rows whose amount dropped to zero.
 * - Skip components that already have a non-open (paid/filed) active row —
 *   do not reverse remitted history and do not insert a duplicate (unique index
 *   covers status <> 'reversed').
 */
export async function syncPayrollPeriodTaxLedger(
  admin: SupabaseClient,
  period: PayrollStatutoryPeriod,
  rows: PayrollStatutorySourceRow[],
  tenantId: string,
  options?: SyncPayrollPeriodTaxLedgerOptions,
): Promise<PayrollStatutoryLedgerResult> {
  const dryRun = options?.dryRun === true;
  const sourceId = buildPayrollPeriodTaxLedgerSourceId(period.payrollMonth);
  const periodMonth = toPeriodMonth(period.payrollMonth);
  const desired = buildDesiredLegs(rows);
  const desiredByComponent = new Map(
    desired.map((leg) => [leg.tax_component, leg]),
  );

  const { data: existingRows, error: selectError } = await admin
    .from("tax_ledger_entries")
    .select("id, tax_component, status, tax_amount")
    .eq("tenant_id", tenantId)
    .eq("source_type", PAYROLL_PERIOD_SOURCE_TYPE)
    .eq("source_id", sourceId)
    .neq("status", "reversed");

  if (selectError) {
    throw new Error(selectError.message);
  }

  const existing = (existingRows as ExistingStatutoryRow[] | null) ?? [];
  const openByComponent = new Map<PayrollStatutoryComponent, ExistingStatutoryRow>();
  const paidOrFiled = new Set<PayrollStatutoryComponent>();

  for (const row of existing) {
    const component = row.tax_component;
    if (row.status === "open") {
      openByComponent.set(component, row);
    } else {
      paidOrFiled.add(component);
    }
  }

  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  let skippedPaid = 0;
  let unchanged = 0;
  const legs: PayrollStatutoryLegLog[] = [];
  const nowIso = new Date().toISOString();

  for (const leg of desired) {
    if (paidOrFiled.has(leg.tax_component)) {
      skippedPaid += 1;
      legs.push({
        tax_component: leg.tax_component,
        tax_amount: leg.tax_amount,
        action: "skipped_paid",
      });
      continue;
    }

    const openRow = openByComponent.get(leg.tax_component);
    if (openRow) {
      if (Number(openRow.tax_amount) === leg.tax_amount) {
        openByComponent.delete(leg.tax_component);
        unchanged += 1;
        legs.push({
          tax_component: leg.tax_component,
          tax_amount: leg.tax_amount,
          action: "unchanged",
        });
        continue;
      }

      if (!dryRun) {
        const { error: updateError } = await admin
          .from("tax_ledger_entries")
          .update({
            entry_date: period.periodEndDate,
            period_month: periodMonth,
            taxable_base: leg.tax_amount,
            tax_amount: leg.tax_amount,
            counterparty_name: leg.counterparty_name,
            notes: `Payroll statutory accrual — ${period.monthLabel}`,
            updated_at: nowIso,
          })
          .eq("id", openRow.id)
          .eq("status", "open");

        if (updateError) {
          throw new Error(updateError.message);
        }
      }

      updated += 1;
      openByComponent.delete(leg.tax_component);
      legs.push({
        tax_component: leg.tax_component,
        tax_amount: leg.tax_amount,
        action: "update",
      });
      continue;
    }

    if (!dryRun) {
      const { error: insertError } = await admin.from("tax_ledger_entries").insert({
        tenant_id: tenantId,
        entry_date: period.periodEndDate,
        period_month: periodMonth,
        direction: "statutory_payable",
        tax_component: leg.tax_component,
        rate_pct: null,
        taxable_base: leg.tax_amount,
        tax_amount: leg.tax_amount,
        status: "open",
        source_type: PAYROLL_PERIOD_SOURCE_TYPE,
        source_id: sourceId,
        counterparty_name: leg.counterparty_name,
        notes: `Payroll statutory accrual — ${period.monthLabel}`,
      });

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    inserted += 1;
    legs.push({
      tax_component: leg.tax_component,
      tax_amount: leg.tax_amount,
      action: "insert",
    });
  }

  // Open legs no longer owed (amount now zero / missing from desired).
  for (const [component, openRow] of openByComponent) {
    if (desiredByComponent.has(component) || paidOrFiled.has(component)) {
      continue;
    }

    if (!dryRun) {
      const { error: deleteError } = await admin
        .from("tax_ledger_entries")
        .delete()
        .eq("id", openRow.id)
        .eq("status", "open");

      if (deleteError) {
        throw new Error(deleteError.message);
      }
    }

    deleted += 1;
    legs.push({
      tax_component: component,
      tax_amount: Number(openRow.tax_amount) || 0,
      action: "delete",
    });
  }

  return {
    sourceId,
    inserted,
    updated,
    deleted,
    skippedPaid,
    unchanged,
    dryRun,
    legs,
  };
}

/** Delete open payroll_period legs for a period (reopen / release). Leaves paid. */
export async function deleteOpenPayrollPeriodTaxLedger(
  admin: SupabaseClient,
  payrollMonth: string,
  tenantId: string,
): Promise<number> {
  const sourceId = buildPayrollPeriodTaxLedgerSourceId(payrollMonth);

  const { data, error: selectError } = await admin
    .from("tax_ledger_entries")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_type", PAYROLL_PERIOD_SOURCE_TYPE)
    .eq("source_id", sourceId)
    .eq("status", "open");

  if (selectError) {
    throw new Error(selectError.message);
  }

  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length === 0) {
    return 0;
  }

  const { error: deleteError } = await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("source_type", PAYROLL_PERIOD_SOURCE_TYPE)
    .eq("source_id", sourceId)
    .eq("status", "open");

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return ids.length;
}
