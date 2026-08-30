import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { getActiveBusinessUnitId } from "@/utils/dashboard-auth";
import {
  MONTH_END_CLOSE_ON_CONFLICT,
  scopeToBusinessUnitId,
} from "@/utils/phase5e-key-structure";
import { assertLockBusinessUnitAllowed } from "@/utils/phase5e-lock";
import { PAYROLL_PERIOD_MANAGE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_OPEN,
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
import {
  applyEmployeeIdScope,
  filterPayrollRowsToEmployeeScope,
  resolvePayrollPeriodScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

type ReleasePeriodBody = {
  payrollMonth?: string;
  periodYear?: number;
  periodMonth?: number;
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(PAYROLL_PERIOD_MANAGE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  let body: ReleasePeriodBody;
  try {
    body = (await request.json()) as ReleasePeriodBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payrollMonth = body.payrollMonth?.slice(0, 10);
  if (!payrollMonth) {
    return NextResponse.json({ error: "payrollMonth is required" }, { status: 400 });
  }

  // Same switcher-gated BU as lock-period stamp / employee scope.
  const businessUnitId = await getActiveBusinessUnitId();

  const lockBuGate = await assertLockBusinessUnitAllowed(
    tenantId,
    businessUnitId,
  );
  if (!lockBuGate.ok) {
    return NextResponse.json({ error: lockBuGate.error }, { status: 400 });
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

  const scopedEmployees = await resolvePayrollPeriodScopedEmployeeIds(
    admin,
    tenantId,
    businessUnitId,
  );
  if (!scopedEmployees.ok) {
    return NextResponse.json({ error: scopedEmployees.error }, { status: 400 });
  }
  const { employeeIds } = scopedEmployees;

  let closeQuery = admin
    .from("month_end_close")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("month", payrollMonth);
  closeQuery = scopeToBusinessUnitId(closeQuery, businessUnitId);
  const { data: closeRecord, error: closeFetchError } =
    await closeQuery.maybeSingle();

  if (closeFetchError) {
    return NextResponse.json({ error: closeFetchError.message }, { status: 400 });
  }

  if (closeRecord?.lock_status !== PAYROLL_STATUS_LOCKED) {
    return NextResponse.json(
      {
        error:
          "Only permanently locked periods can be released. Use Reopen Period for partially locked months.",
      },
      { status: 400 },
    );
  }

  const { data: historyRows, error: historyFetchError } =
    await applyEmployeeIdScope(
      admin
        .from("payroll_history")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("payroll_month", payrollMonth),
      employeeIds,
    );

  if (historyFetchError) {
    return NextResponse.json({ error: historyFetchError.message }, { status: 400 });
  }

  const scopedHistoryResult = filterPayrollRowsToEmployeeScope(
    (historyRows as PayrollHistoryRow[] | null) ?? [],
    employeeIds,
    "No payroll history rows found for this period in the active business unit scope",
  );
  if (!scopedHistoryResult.ok) {
    return NextResponse.json({ error: scopedHistoryResult.error }, { status: 400 });
  }
  const rows = scopedHistoryResult.rows;

  let financeResult;
  try {
    financeResult = await deletePayrollLockFinanceEntries(
      admin,
      financePeriod,
      tenantId,
      {
        loanRepaymentRows: rows.map((row) => ({
          employee_id: row.employee_id,
          loan_repayment: row.loan_repayment,
        })),
      },
    );
  } catch (financeError) {
    const message =
      financeError instanceof Error
        ? financeError.message
        : "Failed to remove payroll finance entries";

    return NextResponse.json({ error: message }, { status: 500 });
  }

  const processingRows = rows.map((row) => ({
    ...historyRowToProcessingPayload(row),
    tenant_id: tenantId,
  }));

  const { error: processingCleanupError } = await applyEmployeeIdScope(
    admin
      .from("payroll_processing")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth),
    employeeIds,
  );

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
    await deletePayrollHistoryForMonth(admin, payrollMonth, tenantId, {
      employeeIds,
    });
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

  const releasedClosePayload = {
    tenant_id: tenantId,
    month: payrollMonth,
    business_unit_id: businessUnitId,
    employees_recorded: rows.length,
    total_net_pay: Math.round(totalNetPay * 100) / 100,
    lock_status: PAYROLL_STATUS_OPEN,
    notes: null,
  };

  const { data: releasedCloseRecord, error: closeUpdateError } = await admin
    .from("month_end_close")
    .upsert(releasedClosePayload, { onConflict: MONTH_END_CLOSE_ON_CONFLICT })
    .select("*")
    .single();

  if (closeUpdateError) {
    return NextResponse.json({ error: closeUpdateError.message }, { status: 400 });
  }

  return NextResponse.json({
    closeRecord: releasedCloseRecord as MonthEndCloseRecord,
    financeResult,
    restoredRows: rows.length,
  });
}
