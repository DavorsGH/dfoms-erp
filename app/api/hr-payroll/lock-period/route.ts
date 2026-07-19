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
} from "@/app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  deletePayrollHistoryForMonth,
  PayrollHistoryCleanupError,
} from "@/app/dashboard/hr-payroll/payroll-history-admin-utils";
import {
  processingRowToHistoryPayload,
  type PayrollProcessingRow,
} from "@/app/dashboard/hr-payroll/payroll-processing-utils";

type LockPeriodBody = {
  payrollMonth?: string;
  periodYear?: number;
  periodMonth?: number;
  lockStatus?: typeof PAYROLL_STATUS_LOCKED | typeof PAYROLL_STATUS_PARTIALLY_LOCKED;
  notes?: string | null;
  rows?: PayrollProcessingRow[];
};

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

  const admin = createAdminClient();
  const lockedAt = new Date().toISOString();
  const totalNetPay = rows.reduce(
    (sum, row) => sum + (Number(row.net_pay) || 0),
    0,
  );

  const { data: existingCloseRecord, error: closeFetchError } = await admin
    .from("month_end_close")
    .select("lock_status")
    .eq("tenant_id", tenantId)
    .eq("month", payrollMonth)
    .maybeSingle();

  if (closeFetchError) {
    return NextResponse.json({ error: closeFetchError.message }, { status: 400 });
  }

  if (
    existingCloseRecord?.lock_status === PAYROLL_STATUS_LOCKED ||
    existingCloseRecord?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED
  ) {
    return NextResponse.json(
      { error: "This payroll period is already locked" },
      { status: 400 },
    );
  }

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
