import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { PAYROLL_PERIOD_MANAGE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  isMonthClosed,
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_OPEN,
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

/**
 * Clear leftover payroll_history only when the month is genuinely Open for the
 * whole tenant. Refuses when any BU's month_end_close is Partially Locked or
 * Locked — deletePayrollHistoryForMonth is tenant-wide and must not wipe a
 * valid lock snapshot.
 */
export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(PAYROLL_PERIOD_MANAGE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

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

  const [viewAllBusinessUnits, businessUnitId] = await Promise.all([
    getViewAllBusinessUnits(),
    getActiveBusinessUnitId(),
  ]);

  if (viewAllBusinessUnits) {
    return NextResponse.json(
      {
        error:
          "Cannot clear payroll history while All Businesses is selected. Switch to workspace default or a specific business unit first.",
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Tenant-wide check: history delete is not BU-scoped.
  const { data: closeRows, error: closeFetchError } = await admin
    .from("month_end_close")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("month", payrollMonth);

  if (closeFetchError) {
    return NextResponse.json({ error: closeFetchError.message }, { status: 400 });
  }

  const allCloseRecords = (closeRows as MonthEndCloseRecord[] | null) ?? [];
  const lockedOrPartial = allCloseRecords.filter((row) => isMonthClosed(row));

  if (lockedOrPartial.length > 0) {
    const statuses = [
      ...new Set(lockedOrPartial.map((row) => row.lock_status ?? "unknown")),
    ].join(", ");
    return NextResponse.json(
      {
        error: `Cannot clear payroll history while this month is ${statuses} for one or more business units. Reopen the period first if you need to discard history.`,
      },
      { status: 400 },
    );
  }

  const scopedClose =
    allCloseRecords.find((row) => {
      const rowBu = row.business_unit_id?.trim() || null;
      const activeBu = businessUnitId?.trim() || null;
      return rowBu === activeBu;
    }) ?? null;

  const lockStatus = scopedClose?.lock_status;

  if (lockStatus === PAYROLL_STATUS_LOCKED) {
    return NextResponse.json(
      { error: "This month is permanently locked and cannot be cleared." },
      { status: 400 },
    );
  }

  // Only Open / Not Started / no MEC row — never Partially Locked.
  const canClearStaleHistory =
    !scopedClose ||
    !lockStatus ||
    lockStatus === PAYROLL_STATUS_OPEN ||
    lockStatus === PAYROLL_STATUS_NOT_STARTED;

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
      tenantId,
    );

    return NextResponse.json({
      deletedHistoryRows,
      closeRecord: scopedClose ?? {
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
