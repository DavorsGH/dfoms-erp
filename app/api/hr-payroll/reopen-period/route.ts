import { NextResponse } from "next/server";
import { requireRoleIn } from "@/utils/admin-auth";
import { PAYROLL_PERIOD_MANAGE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  PAYROLL_STATUS_OPEN,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
  type MonthEndCloseRecord,
} from "@/app/dashboard/hr-payroll/payroll-period-utils";
import {
  deletePayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
} from "@/app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  deletePayrollHistoryForMonth,
  PayrollHistoryCleanupError,
} from "@/app/dashboard/hr-payroll/payroll-history-admin-utils";
import {
  historyRowToProcessingPayload,
  type PayrollHistoryRow,
} from "@/app/dashboard/hr-payroll/payroll-processing-utils";

type ReopenPeriodBody = {
  payrollMonth?: string;
  periodYear?: number;
  periodMonth?: number;
};

export async function POST(request: Request) {
  const auth = await requireRoleIn(PAYROLL_PERIOD_MANAGE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: ReopenPeriodBody;
  try {
    body = (await request.json()) as ReopenPeriodBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payrollMonth = body.payrollMonth?.slice(0, 10);
  if (!payrollMonth) {
    return NextResponse.json({ error: "payrollMonth is required" }, { status: 400 });
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

  const { data: closeRecord, error: closeFetchError } = await admin
    .from("month_end_close")
    .select("*")
    .eq("month", payrollMonth)
    .maybeSingle();

  if (closeFetchError) {
    return NextResponse.json({ error: closeFetchError.message }, { status: 400 });
  }

  if (closeRecord?.lock_status !== PAYROLL_STATUS_PARTIALLY_LOCKED) {
    return NextResponse.json(
      { error: "Only partially locked periods can be reopened" },
      { status: 400 },
    );
  }

  const { data: historyRows, error: historyFetchError } = await admin
    .from("payroll_history")
    .select("*")
    .eq("payroll_month", payrollMonth);

  if (historyFetchError) {
    return NextResponse.json({ error: historyFetchError.message }, { status: 400 });
  }

  const rows = (historyRows as PayrollHistoryRow[] | null) ?? [];

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No payroll history rows found for this period" },
      { status: 400 },
    );
  }

  if (rows.some((row) => row.locked)) {
    return NextResponse.json(
      {
        error:
          "This period has permanently locked payroll records and cannot be reopened",
      },
      { status: 400 },
    );
  }

  let financeResult;
  try {
    financeResult = await deletePayrollLockFinanceEntries(admin, financePeriod);
  } catch (financeError) {
    const message =
      financeError instanceof Error
        ? financeError.message
        : "Failed to remove payroll finance entries";

    return NextResponse.json({ error: message }, { status: 500 });
  }

  const processingRows = rows.map((row) => historyRowToProcessingPayload(row));

  const { error: processingCleanupError } = await admin
    .from("payroll_processing")
    .delete()
    .eq("payroll_month", payrollMonth);

  if (processingCleanupError) {
    return NextResponse.json(
      { error: processingCleanupError.message },
      { status: 400 },
    );
  }

  const { error: processingInsertError } = await admin
    .from("payroll_processing")
    .insert(processingRows);

  if (processingInsertError) {
    return NextResponse.json(
      { error: processingInsertError.message },
      { status: 400 },
    );
  }

  try {
    await deletePayrollHistoryForMonth(admin, payrollMonth);
  } catch (cleanupError) {
    const message =
      cleanupError instanceof PayrollHistoryCleanupError
        ? cleanupError.message
        : "Failed to delete payroll history for this period";

    return NextResponse.json({ error: message }, { status: 400 });
  }

  const totalNetPay = rows.reduce(
    (sum, row) => sum + (Number(row.net_pay) || 0),
    0,
  );

  const reopenedClosePayload = {
    month: payrollMonth,
    employees_recorded: rows.length,
    total_net_pay: Math.round(totalNetPay * 100) / 100,
    lock_status: PAYROLL_STATUS_OPEN,
    notes: null,
  };

  const { data: reopenedCloseRecord, error: closeUpdateError } = await admin
    .from("month_end_close")
    .upsert(reopenedClosePayload, { onConflict: "month" })
    .select("*")
    .single();

  if (closeUpdateError) {
    return NextResponse.json({ error: closeUpdateError.message }, { status: 400 });
  }

  return NextResponse.json({
    closeRecord: reopenedCloseRecord as MonthEndCloseRecord,
    financeResult,
    restoredRows: rows.length,
  });
}
