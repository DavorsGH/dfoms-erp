import type { SupabaseClient } from "@supabase/supabase-js";

import { toPeriodMonth } from "@/app/dashboard/finance/tax-utils";
import {
  STAFF_WELFARE_FUND_PAYROLL_SOURCE_TYPE,
  type StaffWelfareFundEntryType,
  type StaffWelfareFundLedgerStatus,
  type StaffWelfareFundSourceType,
} from "@/app/dashboard/finance/staff-welfare-fund-utils";
import { buildPayrollPeriodTaxLedgerSourceId } from "./payroll-statutory-ledger-sync";

export type PayrollWelfareFundSourceRow = {
  welfare_deduction?: number | null;
};

export type PayrollWelfareFundPeriod = {
  payrollMonth: string;
  monthLabel: string;
  periodEndDate: string;
};

export type SyncPayrollWelfareFundAccrualOptions = {
  businessUnitId?: string | null;
};

export type PayrollWelfareFundAccrualResult = {
  sourceId: string;
  action: "insert" | "update" | "delete" | "unchanged" | "skipped_settled";
  amount: number;
};

type ExistingAccrualRow = {
  id: string;
  status: StaffWelfareFundLedgerStatus;
  amount: number;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumWelfareDeduction(rows: PayrollWelfareFundSourceRow[]): number {
  return roundCurrency(
    rows.reduce(
      (sum, row) => sum + (Number(row.welfare_deduction) || 0),
      0,
    ),
  );
}

/**
 * Upsert one payroll-period welfare accrual after payroll lock.
 * Skips when an existing accrual is no longer open (settled/reversed).
 */
export async function syncPayrollWelfareFundAccrual(
  admin: SupabaseClient,
  period: PayrollWelfareFundPeriod,
  rows: PayrollWelfareFundSourceRow[],
  tenantId: string,
  options?: SyncPayrollWelfareFundAccrualOptions,
): Promise<PayrollWelfareFundAccrualResult> {
  const businessUnitId = Object.prototype.hasOwnProperty.call(
    options ?? {},
    "businessUnitId",
  )
    ? (options?.businessUnitId ?? null)
    : null;
  const sourceId = buildPayrollPeriodTaxLedgerSourceId(period.payrollMonth);
  const periodMonth = toPeriodMonth(period.payrollMonth);
  const amount = sumWelfareDeduction(rows);
  const nowIso = new Date().toISOString();

  let existingQuery = admin
    .from("staff_welfare_fund_ledger")
    .select("id, status, amount")
    .eq("tenant_id", tenantId)
    .eq("source_type", STAFF_WELFARE_FUND_PAYROLL_SOURCE_TYPE)
    .eq("source_id", sourceId)
    .eq("entry_type", "accrual" satisfies StaffWelfareFundEntryType);

  if (businessUnitId === null) {
    existingQuery = existingQuery.is("business_unit_id", null);
  } else {
    existingQuery = existingQuery.eq("business_unit_id", businessUnitId);
  }

  const { data: existingRow, error: selectError } =
    await existingQuery.maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }

  const existing = existingRow as ExistingAccrualRow | null;

  if (existing && existing.status !== "open") {
    return {
      sourceId,
      action: "skipped_settled",
      amount,
    };
  }

  if (amount <= 0) {
    if (!existing) {
      return { sourceId, action: "unchanged", amount: 0 };
    }

    const { error: deleteError } = await admin
      .from("staff_welfare_fund_ledger")
      .delete()
      .eq("id", existing.id)
      .eq("status", "open");

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return { sourceId, action: "delete", amount: 0 };
  }

  if (existing) {
    if (Number(existing.amount) === amount) {
      return { sourceId, action: "unchanged", amount };
    }

    const { error: updateError } = await admin
      .from("staff_welfare_fund_ledger")
      .update({
        entry_date: period.periodEndDate,
        period_month: periodMonth,
        amount,
        counterparty_name: "Staff Welfare Fund",
        notes: `Payroll welfare accrual — ${period.monthLabel}`,
        updated_at: nowIso,
      })
      .eq("id", existing.id)
      .eq("status", "open");

    if (updateError) {
      throw new Error(updateError.message);
    }

    return { sourceId, action: "update", amount };
  }

  const { error: insertError } = await admin
    .from("staff_welfare_fund_ledger")
    .insert({
      tenant_id: tenantId,
      business_unit_id: businessUnitId,
      entry_date: period.periodEndDate,
      period_month: periodMonth,
      entry_type: "accrual" satisfies StaffWelfareFundEntryType,
      amount,
      status: "open" satisfies StaffWelfareFundLedgerStatus,
      source_type:
        STAFF_WELFARE_FUND_PAYROLL_SOURCE_TYPE satisfies StaffWelfareFundSourceType,
      source_id: sourceId,
      employee_id: null,
      counterparty_name: "Staff Welfare Fund",
      notes: `Payroll welfare accrual — ${period.monthLabel}`,
    });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return { sourceId, action: "insert", amount };
}

/** Delete open payroll-period welfare accrual on reopen/release. */
export async function deleteOpenPayrollWelfareFundAccrual(
  admin: SupabaseClient,
  payrollMonth: string,
  tenantId: string,
  businessUnitId: string | null,
): Promise<number> {
  const sourceId = buildPayrollPeriodTaxLedgerSourceId(payrollMonth);

  let selectQuery = admin
    .from("staff_welfare_fund_ledger")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_type", STAFF_WELFARE_FUND_PAYROLL_SOURCE_TYPE)
    .eq("source_id", sourceId)
    .eq("entry_type", "accrual")
    .eq("status", "open");

  if (businessUnitId === null) {
    selectQuery = selectQuery.is("business_unit_id", null);
  } else {
    selectQuery = selectQuery.eq("business_unit_id", businessUnitId);
  }

  const { data, error } = await selectQuery;

  if (error) {
    throw new Error(error.message);
  }

  if ((data?.length ?? 0) === 0) {
    return 0;
  }

  let deleteQuery = admin
    .from("staff_welfare_fund_ledger")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("source_type", STAFF_WELFARE_FUND_PAYROLL_SOURCE_TYPE)
    .eq("source_id", sourceId)
    .eq("entry_type", "accrual")
    .eq("status", "open");

  if (businessUnitId === null) {
    deleteQuery = deleteQuery.is("business_unit_id", null);
  } else {
    deleteQuery = deleteQuery.eq("business_unit_id", businessUnitId);
  }

  const { error: deleteError } = await deleteQuery;

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return data?.length ?? 0;
}
