import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { PAYROLL_PERIOD_MANAGE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_OPEN,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
  PAYROLL_STATUS_NOT_STARTED,
  formatPeriodLabel,
  isPayrollMonthEnded,
  type MonthEndCloseRecord,
} from "@/app/dashboard/hr-payroll/payroll-period-utils";
import {
  postPayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
  type PayrollLockFinanceSourceRow,
} from "@/app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  deletePayrollHistoryForMonth,
  PayrollHistoryCleanupError,
} from "@/app/dashboard/hr-payroll/payroll-history-admin-utils";
import {
  processingRowToHistoryPayload,
  type PayrollHistoryRow,
  type PayrollProcessingRow,
} from "@/app/dashboard/hr-payroll/payroll-processing-utils";
import { promoteAllowanceLinesToHistory } from "@/app/dashboard/hr-payroll/payroll-allowance-lines-utils";

type LockPeriodBody = {
  payrollMonth?: string;
  periodYear?: number;
  periodMonth?: number;
  lockStatus?: typeof PAYROLL_STATUS_LOCKED | typeof PAYROLL_STATUS_PARTIALLY_LOCKED;
  notes?: string | null;
  rows?: PayrollProcessingRow[];
};

function historyRowsToFinanceSource(
  rows: PayrollHistoryRow[],
): PayrollLockFinanceSourceRow[] {
  return rows.map((row) => ({
    employee_id: row.employee_id,
    gross_pay: row.gross_pay,
    net_only_adjustment: row.net_only_adjustment,
    absence_deduction: row.absence_deduction,
    loan_repayment: row.loan_repayment,
    salary_advance: row.salary_advance,
    welfare_deduction: row.welfare_deduction,
    other_deductions: row.other_deductions,
    employee_ssnit: row.employee_ssnit,
    employer_ssnit: row.employer_ssnit,
    tier2: row.tier2,
    paye_tax: row.paye_tax,
  }));
}

/**
 * Promote Partially Locked → Locked without re-inserting history or
 * re-applying loan repayments. Marks Staff Salaries Paid (Cash Position).
 */
async function promotePartialToFullLock(params: {
  admin: ReturnType<typeof createAdminClient>;
  tenantId: string;
  payrollMonth: string;
  periodYear?: number;
  periodMonth?: number;
  existingCloseRecord: {
    employees_recorded: number | null;
    total_net_pay: number | null;
    notes: string | null;
  };
}) {
  const {
    admin,
    tenantId,
    payrollMonth,
    periodYear,
    periodMonth,
    existingCloseRecord,
  } = params;

  if (
    periodYear &&
    periodMonth &&
    !isPayrollMonthEnded(periodYear, periodMonth)
  ) {
    return NextResponse.json(
      {
        error: `Permanent lock is only allowed on or after ${formatPeriodLabel(periodYear, periodMonth)} ends. Keep the period Partially Locked until then.`,
      },
      { status: 400 },
    );
  }

  // Fallback when periodYear/periodMonth omitted — derive from payrollMonth.
  if ((!periodYear || !periodMonth) && payrollMonth.length >= 7) {
    const derivedYear = Number.parseInt(payrollMonth.slice(0, 4), 10);
    const derivedMonth = Number.parseInt(payrollMonth.slice(5, 7), 10);
    if (
      Number.isFinite(derivedYear) &&
      Number.isFinite(derivedMonth) &&
      !isPayrollMonthEnded(derivedYear, derivedMonth)
    ) {
      return NextResponse.json(
        {
          error: `Permanent lock is only allowed on or after ${formatPeriodLabel(derivedYear, derivedMonth)} ends. Keep the period Partially Locked until then.`,
        },
        { status: 400 },
      );
    }
  }

  const financePeriod = resolvePayrollLockFinancePeriod(
    payrollMonth,
    periodYear,
    periodMonth,
  );

  if (!financePeriod) {
    return NextResponse.json(
      { error: "Unable to resolve payroll period dates" },
      { status: 400 },
    );
  }

  const { data: historyData, error: historyFetchError } = await admin
    .from("payroll_history")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (historyFetchError) {
    return NextResponse.json({ error: historyFetchError.message }, { status: 400 });
  }

  const historyRows = (historyData as PayrollHistoryRow[] | null) ?? [];

  if (historyRows.length === 0) {
    return NextResponse.json(
      { error: "No payroll history rows found for this partially locked period" },
      { status: 400 },
    );
  }

  if (historyRows.some((row) => row.locked)) {
    return NextResponse.json(
      {
        error:
          "This period already has permanently locked payroll records. Use Release to Open if needed.",
      },
      { status: 400 },
    );
  }

  const lockedAt = new Date().toISOString();
  const totalNetPay = historyRows.reduce(
    (sum, row) => sum + (Number(row.net_pay) || 0),
    0,
  );

  const { error: historyLockError } = await admin
    .from("payroll_history")
    .update({ locked: true, locked_at: lockedAt })
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (historyLockError) {
    return NextResponse.json({ error: historyLockError.message }, { status: 400 });
  }

  const monthEndPayload = {
    tenant_id: tenantId,
    month: payrollMonth,
    employees_recorded: historyRows.length,
    total_net_pay: Math.round(totalNetPay * 100) / 100,
    lock_status: PAYROLL_STATUS_LOCKED,
    // Clear partial-lock note once permanently locked.
    notes: null,
  };

  const { data: closeRecord, error: closeError } = await admin
    .from("month_end_close")
    .upsert(monthEndPayload, { onConflict: "tenant_id,month" })
    .select("*")
    .single();

  if (closeError) {
    // Best-effort rollback of history locked flags
    await admin
      .from("payroll_history")
      .update({ locked: false, locked_at: null })
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth);

    return NextResponse.json({ error: closeError.message }, { status: 400 });
  }

  try {
    const financeResult = await postPayrollLockFinanceEntries(
      admin,
      financePeriod,
      historyRowsToFinanceSource(historyRows),
      tenantId,
      {
        markStaffSalariesPaid: true,
        // Loans already applied on Partial Lock — do not double-apply.
        skipLoanRepayments: true,
      },
    );

    return NextResponse.json({
      closeRecord: closeRecord as MonthEndCloseRecord,
      financeResult,
      promotedFromPartial: true,
      previousEmployeesRecorded: existingCloseRecord.employees_recorded,
    });
  } catch (financeError) {
    const message =
      financeError instanceof Error
        ? financeError.message
        : "Failed to post payroll finance entries";

    return NextResponse.json(
      {
        error: `Payroll fully locked, but finance posting failed: ${message}`,
        closeRecord: closeRecord as MonthEndCloseRecord,
        payrollLocked: true,
        promotedFromPartial: true,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(PAYROLL_PERIOD_MANAGE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  let body: LockPeriodBody;
  try {
    body = (await request.json()) as LockPeriodBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payrollMonth = body.payrollMonth?.slice(0, 10);
  const lockStatus = body.lockStatus;
  const rows = body.rows ?? [];

  if (!payrollMonth) {
    return NextResponse.json({ error: "payrollMonth is required" }, { status: 400 });
  }

  if (
    lockStatus !== PAYROLL_STATUS_LOCKED &&
    lockStatus !== PAYROLL_STATUS_PARTIALLY_LOCKED
  ) {
    return NextResponse.json({ error: "Invalid lock status" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existingCloseRecord, error: closeFetchError } = await admin
    .from("month_end_close")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("month", payrollMonth)
    .maybeSingle();

  if (closeFetchError) {
    return NextResponse.json({ error: closeFetchError.message }, { status: 400 });
  }

  // Partial → Full Lock promote (history already exists; Accrued → Paid).
  if (
    existingCloseRecord?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED &&
    lockStatus === PAYROLL_STATUS_LOCKED
  ) {
    return promotePartialToFullLock({
      admin,
      tenantId,
      payrollMonth,
      periodYear: body.periodYear,
      periodMonth: body.periodMonth,
      existingCloseRecord,
    });
  }

  if (existingCloseRecord?.lock_status === PAYROLL_STATUS_LOCKED) {
    return NextResponse.json(
      { error: "This payroll period is already locked" },
      { status: 400 },
    );
  }

  if (existingCloseRecord?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED) {
    return NextResponse.json(
      { error: "This payroll period is already locked" },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No payroll rows to lock for this period" },
      { status: 400 },
    );
  }

  if (
    lockStatus === PAYROLL_STATUS_LOCKED &&
    body.periodYear &&
    body.periodMonth &&
    !isPayrollMonthEnded(body.periodYear, body.periodMonth)
  ) {
    return NextResponse.json(
      {
        error: `Permanent lock is only allowed on or after ${formatPeriodLabel(body.periodYear, body.periodMonth)} ends. Use Partial Lock Period until then.`,
      },
      { status: 400 },
    );
  }

  const financePeriod = resolvePayrollLockFinancePeriod(
    payrollMonth,
    body.periodYear,
    body.periodMonth,
  );

  if (!financePeriod) {
    return NextResponse.json(
      { error: "Unable to resolve payroll period dates" },
      { status: 400 },
    );
  }

  const lockedAt = new Date().toISOString();
  const totalNetPay = rows.reduce(
    (sum, row) => sum + (Number(row.net_pay) || 0),
    0,
  );

  const { data: existingHistory, error: existingHistoryError } = await admin
    .from("payroll_history")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (existingHistoryError) {
    return NextResponse.json({ error: existingHistoryError.message }, { status: 400 });
  }

  if ((existingHistory?.length ?? 0) > 0) {
    const periodIsOpen =
      !existingCloseRecord?.lock_status ||
      existingCloseRecord.lock_status === PAYROLL_STATUS_OPEN ||
      existingCloseRecord.lock_status === PAYROLL_STATUS_NOT_STARTED;

    if (!periodIsOpen) {
      return NextResponse.json(
        { error: "This payroll period is already locked" },
        { status: 400 },
      );
    }

    try {
      await deletePayrollHistoryForMonth(admin, payrollMonth, tenantId);
    } catch (cleanupError) {
      const message =
        cleanupError instanceof PayrollHistoryCleanupError
          ? cleanupError.message
          : "Failed to clear existing payroll history before locking";

      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const isFullyLocked = lockStatus === PAYROLL_STATUS_LOCKED;

  const historyRows = rows.map((row) => ({
    ...processingRowToHistoryPayload(
      row,
      payrollMonth,
      isFullyLocked,
      isFullyLocked ? lockedAt : null,
    ),
    tenant_id: tenantId,
  }));

  const { error: historyError } = await admin
    .from("payroll_history")
    .insert(historyRows);

  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 400 });
  }

  const { error: deleteError } = await admin
    .from("payroll_processing")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  const allowancePromote = await promoteAllowanceLinesToHistory(
    admin,
    tenantId,
    payrollMonth,
  );
  if (allowancePromote.error) {
    return NextResponse.json(
      { error: allowancePromote.error },
      { status: 400 },
    );
  }

  const monthEndPayload = {
    tenant_id: tenantId,
    month: payrollMonth,
    employees_recorded: historyRows.length,
    total_net_pay: Math.round(totalNetPay * 100) / 100,
    lock_status: lockStatus,
    notes: body.notes?.trim() || null,
  };

  const { data: closeRecord, error: closeError } = await admin
    .from("month_end_close")
    .upsert(monthEndPayload, { onConflict: "tenant_id,month" })
    .select("*")
    .single();

  if (closeError) {
    return NextResponse.json({ error: closeError.message }, { status: 400 });
  }

  try {
    const financeResult = await postPayrollLockFinanceEntries(
      admin,
      financePeriod,
      rows,
      tenantId,
      {
        // Permanent Lock → Paid (SAL only). Partial Lock stays Accrued.
        markStaffSalariesPaid: isFullyLocked,
      },
    );

    return NextResponse.json({
      closeRecord: closeRecord as MonthEndCloseRecord,
      financeResult,
    });
  } catch (financeError) {
    const message =
      financeError instanceof Error
        ? financeError.message
        : "Failed to post payroll finance entries";

    return NextResponse.json(
      {
        error: `Payroll locked, but finance posting failed: ${message}`,
        closeRecord: closeRecord as MonthEndCloseRecord,
        payrollLocked: true,
      },
      { status: 500 },
    );
  }
}
