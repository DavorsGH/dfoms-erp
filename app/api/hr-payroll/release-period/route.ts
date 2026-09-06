import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { getActiveBusinessUnitId } from "@/utils/dashboard-auth";
import { assertLockBusinessUnitAllowed } from "@/utils/phase5e-lock";
import { PAYROLL_PERIOD_MANAGE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import type { MonthEndCloseRecord } from "@/app/dashboard/hr-payroll/payroll-period-utils";
import { resolvePayrollPeriodScopedEmployeeIds } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

type ReleasePeriodBody = {
  payrollMonth?: string;
  periodYear?: number;
  periodMonth?: number;
};

type ReleasePayrollPeriodRpcResult = {
  closeRecord?: MonthEndCloseRecord;
  financeResult?: Record<string, unknown>;
  restoredRows?: number;
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

  const businessUnitId = await getActiveBusinessUnitId();

  const lockBuGate = await assertLockBusinessUnitAllowed(
    tenantId,
    businessUnitId,
  );
  if (!lockBuGate.ok) {
    return NextResponse.json({ error: lockBuGate.error }, { status: 400 });
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

  const { data, error } = await admin.rpc("release_payroll_period", {
    p_tenant_id: tenantId,
    p_business_unit_id: businessUnitId,
    p_employee_ids: employeeIds,
    p_payroll_month: payrollMonth,
    p_period_year: body.periodYear ?? null,
    p_period_month: body.periodMonth ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const payload = (data ?? {}) as ReleasePayrollPeriodRpcResult;

  return NextResponse.json({
    closeRecord: payload.closeRecord as MonthEndCloseRecord,
    financeResult: payload.financeResult,
    restoredRows: payload.restoredRows ?? 0,
  });
}
