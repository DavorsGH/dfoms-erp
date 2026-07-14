import { NextResponse } from "next/server";
import { requireRoleIn } from "@/utils/admin-auth";
import { PAYROLL_PERIOD_MANAGE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_OPEN,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
  PAYROLL_STATUS_NOT_STARTED,
  type MonthEndCloseRecord,
} from "@/app/dashboard/hr-payroll/payroll-period-utils";
import {
  deletePayrollHistoryForMonth,
  PayrollHistoryCleanupError,
} from "@/app/dashboard/hr-payroll/payroll-history-admin-utils";

type RepairPeriodBody = {
  payrollMonth?: string;
};

export async function POST(request: Request) {
  const auth = await requireRoleIn(PAYROLL_PERIOD_MANAGE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: RepairPeriodBody;
  try {
    body = (await request.json()) as RepairPeriodBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payrollMonth = body.payrollMonth?.slice(0, 10);
  if (!payrollMonth) {
    return NextResponse.json({ error: "payrollMonth is required" }, { status: 400 });
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

  const lockStatus = closeRecord?.lock_status;

  if (lockStatus === PAYROLL_STATUS_LOCKED) {
    return NextResponse.json(
      { error: "This month is permanently locked and cannot be cleared." },
      { status: 400 },
    );
  }

  const canClearStaleHistory =
    !closeRecord ||
    !lockStatus ||
    lockStatus === PAYROLL_STATUS_OPEN ||
    lockStatus === PAYROLL_STATUS_NOT_STARTED ||
    lockStatus === PAYROLL_STATUS_PARTIALLY_LOCKED;

  if (!canClearStaleHistory) {
    return NextResponse.json(
      { error: "This month cannot be cleared in its current lock status." },
      { status: 400 },
    );
  }

  try {
    const deletedHistoryRows = await deletePayrollHistoryForMonth(
      admin,
      payrollMonth,
    );

    return NextResponse.json({
      deletedHistoryRows,
      closeRecord: (closeRecord as MonthEndCloseRecord | null) ?? {
        month: payrollMonth,
        employees_recorded: 0,
        total_net_pay: 0,
        lock_status: PAYROLL_STATUS_OPEN,
        notes: null,
      },
    });
  } catch (cleanupError) {
    const message =
      cleanupError instanceof PayrollHistoryCleanupError
        ? cleanupError.message
        : "Failed to clear stale payroll history";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
