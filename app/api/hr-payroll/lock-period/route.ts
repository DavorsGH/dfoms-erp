import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { scopeToBusinessUnitId } from "@/utils/phase5e-key-structure";
import {
  assertLockBusinessUnitAllowed,
  resolvePayrollWriteBusinessUnitId,
} from "@/utils/phase5e-lock";
import { PAYROLL_PERIOD_MANAGE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
  formatPeriodLabel,
  isPayrollMonthEnded,
  type MonthEndCloseRecord,
} from "@/app/dashboard/hr-payroll/payroll-period-utils";
import {
  filterPayrollRowsToEmployeeScope,
  resolvePayrollPeriodScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import type { PayrollProcessingRow } from "@/app/dashboard/hr-payroll/payroll-processing-utils";
import {
  fetchStatutoryPayrollTaxConfigs,
  validateStatutoryPayrollBeforeLock,
} from "@/app/dashboard/hr-payroll/statutory-payroll-config-utils";

type LockPeriodBody = {
  payrollMonth?: string;
  periodYear?: number;
  periodMonth?: number;
  lockStatus?: typeof PAYROLL_STATUS_LOCKED | typeof PAYROLL_STATUS_PARTIALLY_LOCKED;
  notes?: string | null;
  rows?: PayrollProcessingRow[];
};

type LockPayrollPeriodRpcResult = {
  closeRecord?: MonthEndCloseRecord;
  financeResult?: Record<string, unknown>;
  promotedFromPartial?: boolean;
  previousEmployeesRecorded?: number | null;
};

export async function POST(request: Request) {
  try {
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
    const writeBu = await resolvePayrollWriteBusinessUnitId(tenantId);
    if (!writeBu.ok) {
      return NextResponse.json({ error: writeBu.error }, { status: 400 });
    }
    const businessUnitId = writeBu.businessUnitId;

    if (!payrollMonth) {
      return NextResponse.json({ error: "payrollMonth is required" }, { status: 400 });
    }

    if (
      lockStatus !== PAYROLL_STATUS_LOCKED &&
      lockStatus !== PAYROLL_STATUS_PARTIALLY_LOCKED
    ) {
      return NextResponse.json({ error: "Invalid lock status" }, { status: 400 });
    }

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

    let closeQuery = admin
      .from("month_end_close")
      .select("lock_status")
      .eq("tenant_id", tenantId)
      .eq("month", payrollMonth);
    closeQuery = scopeToBusinessUnitId(closeQuery, businessUnitId);
    const { data: existingCloseRecord, error: closeFetchError } =
      await closeQuery.maybeSingle();

    if (closeFetchError) {
      return NextResponse.json({ error: closeFetchError.message }, { status: 400 });
    }

    const isPromote =
      existingCloseRecord?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED &&
      lockStatus === PAYROLL_STATUS_LOCKED;

    let scopedRows = rows;
    if (!isPromote) {
      const scopedRowsResult = filterPayrollRowsToEmployeeScope(
        rows,
        employeeIds,
        "No payroll rows to lock for this period",
      );
      if (!scopedRowsResult.ok) {
        return NextResponse.json({ error: scopedRowsResult.error }, { status: 400 });
      }
      scopedRows = scopedRowsResult.rows;
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

    const periodYear =
      body.periodYear ??
      (payrollMonth ? Number(payrollMonth.slice(0, 4)) : undefined);
    const periodMonth =
      body.periodMonth ??
      (payrollMonth ? Number(payrollMonth.slice(5, 7)) : undefined);

    if (periodYear && periodMonth) {
      const { taxConfigs, error: statutoryFetchError } =
        await fetchStatutoryPayrollTaxConfigs(admin);
      if (statutoryFetchError) {
        return NextResponse.json(
          { error: statutoryFetchError },
          { status: 400 },
        );
      }

      let employeesQuery = admin
        .from("employees")
        .select("employment_type")
        .eq("tenant_id", tenantId);
      if (employeeIds !== null) {
        if (employeeIds.length === 0) {
          return NextResponse.json(
            { error: "No employees in scope for this lock." },
            { status: 400 },
          );
        }
        employeesQuery = employeesQuery.in("employee_id", employeeIds);
      }

      const { data: scopedEmployeeRows, error: scopedEmployeesError } =
        await employeesQuery;
      if (scopedEmployeesError) {
        return NextResponse.json(
          { error: scopedEmployeesError.message },
          { status: 400 },
        );
      }

      const statutoryBlock = validateStatutoryPayrollBeforeLock({
        taxConfigs,
        periodYear,
        periodMonth,
        employees: (scopedEmployeeRows ?? []) as Array<{
          employment_type: string | null;
        }>,
      });
      if (statutoryBlock) {
        return NextResponse.json({ error: statutoryBlock }, { status: 400 });
      }
    }

    const { data, error } = await admin.rpc("lock_payroll_period", {
      p_tenant_id: tenantId,
      p_business_unit_id: businessUnitId,
      p_employee_ids: employeeIds,
      p_payroll_month: payrollMonth,
      p_period_year: body.periodYear ?? null,
      p_period_month: body.periodMonth ?? null,
      p_lock_status: lockStatus,
      p_notes: body.notes?.trim() || null,
      p_rows: scopedRows,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const payload = (data ?? {}) as LockPayrollPeriodRpcResult;

    return NextResponse.json({
      closeRecord: payload.closeRecord as MonthEndCloseRecord,
      financeResult: payload.financeResult,
      promotedFromPartial: payload.promotedFromPartial ?? false,
      previousEmployeesRecorded: payload.previousEmployeesRecorded ?? null,
    });
  } catch (error) {
    console.error("[hr-payroll/lock-period]", error);
    const message =
      error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
