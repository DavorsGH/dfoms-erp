import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { calculateOvertimeAmount } from "@/app/dashboard/hr-payroll/hr-register-utils";
import {
  fetchScopedEmployeeIds,
  applyEmployeeIdScope,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  firstOvertimeFieldError,
  normalizeOvertimeDayType,
  validateOvertimeEntryInput,
  type OvertimeDayType,
} from "@/app/dashboard/hr-payroll/overtime-register-validation";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

type SharedOvertimePayload = {
  date?: string;
  day_type?: string;
  hours_worked?: number | string;
  overtime_hours?: number | string;
  overtime_rate?: number | string;
  approved_by?: string;
};

function parseSharedFields(body: SharedOvertimePayload) {
  const dayType = normalizeOvertimeDayType(body.day_type);
  const hoursWorked = Number(body.hours_worked);
  const overtimeHours = Number(body.overtime_hours);
  const overtimeRate = Number(body.overtime_rate);
  const approvedBy = String(body.approved_by ?? "").trim();
  const date = String(body.date ?? "").trim().slice(0, 10);

  return {
    date,
    day_type: dayType as OvertimeDayType,
    hours_worked: hoursWorked,
    overtime_hours: overtimeHours,
    overtime_rate: overtimeRate,
    approved_by: approvedBy,
  };
}

function validationErrorResponse(errors: ReturnType<typeof validateOvertimeEntryInput>) {
  return NextResponse.json(
    { error: firstOvertimeFieldError(errors) ?? "Invalid overtime entry." },
    { status: 400 },
  );
}

async function resolveAllowedEmployeeIds(tenantId: string) {
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  return fetchScopedEmployeeIds(await getTenantSupabase(), tenantId, buScope);
}

async function assertEmployeesAllowed(
  tenantId: string,
  employeeIds: string[],
): Promise<NextResponse | null> {
  const uniqueIds = [...new Set(employeeIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one employee." },
      { status: 400 },
    );
  }

  const { employeeIds: scopedIds, error: scopeError } =
    await resolveAllowedEmployeeIds(tenantId);
  if (scopeError) {
    return NextResponse.json({ error: scopeError }, { status: 400 });
  }

  if (scopedIds !== null) {
    const allowed = new Set(scopedIds);
    const outOfScope = uniqueIds.filter((id) => !allowed.has(id));
    if (outOfScope.length > 0) {
      return NextResponse.json(
        { error: "One or more employees are outside your business unit scope." },
        { status: 403 },
      );
    }
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", tenantId)
    .in("employee_id", uniqueIds);

  if (error) {
    console.error("[overtime-register] employee lookup failed", error);
    return NextResponse.json(
      { error: "Unable to verify employees." },
      { status: 500 },
    );
  }

  const found = new Set(
    ((data as Array<{ employee_id: string }> | null) ?? []).map(
      (row) => row.employee_id,
    ),
  );
  if (found.size !== uniqueIds.length) {
    return NextResponse.json(
      { error: "One or more employees could not be found in your workspace." },
      { status: 400 },
    );
  }

  return null;
}

function buildRowPayload(
  tenantId: string,
  employeeId: string,
  fields: ReturnType<typeof parseSharedFields>,
) {
  const overtimeAmount = calculateOvertimeAmount(
    fields.overtime_hours,
    fields.overtime_rate,
  );

  return {
    tenant_id: tenantId,
    employee_id: employeeId,
    date: fields.date,
    day_type: fields.day_type,
    hours_worked: fields.hours_worked,
    overtime_hours: fields.overtime_hours,
    overtime_rate: fields.overtime_rate,
    overtime_amount: overtimeAmount,
    approved_by: fields.approved_by,
  };
}

export async function POST(request: Request) {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return NextResponse.json(
      { error: "Unable to resolve your workspace." },
      { status: 401 },
    );
  }

  let body: SharedOvertimePayload & { employee_ids?: string[] };
  try {
    body = (await request.json()) as SharedOvertimePayload & {
      employee_ids?: string[];
    };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const employeeIds = Array.isArray(body.employee_ids) ? body.employee_ids : [];
  const scopeError = await assertEmployeesAllowed(tenantId, employeeIds);
  if (scopeError) {
    return scopeError;
  }

  const fields = parseSharedFields(body);
  if (!fields.day_type) {
    return NextResponse.json({ error: "Day type is required." }, { status: 400 });
  }

  const fieldErrors = validateOvertimeEntryInput({
    date: fields.date,
    hours_worked: fields.hours_worked,
    overtime_hours: fields.overtime_hours,
    overtime_rate: fields.overtime_rate,
    approved_by: fields.approved_by,
    day_type: fields.day_type,
  });
  if (Object.keys(fieldErrors).length > 0) {
    return validationErrorResponse(fieldErrors);
  }

  const uniqueEmployeeIds = [
    ...new Set(employeeIds.map((id) => id.trim()).filter(Boolean)),
  ];
  const rows = uniqueEmployeeIds.map((employeeId) =>
    buildRowPayload(tenantId, employeeId, fields),
  );

  const supabase = await getTenantSupabase();
  const { error: insertError } = await supabase.from("overtime_register").insert(rows);

  if (insertError) {
    console.error("[overtime-register POST]", insertError);
    return NextResponse.json(
      { error: insertError.message || "Failed to save overtime entries." },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, count: rows.length });
}

export async function PATCH(request: Request) {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return NextResponse.json(
      { error: "Unable to resolve your workspace." },
      { status: 401 },
    );
  }

  let body: SharedOvertimePayload & { id?: string; employee_id?: string };
  try {
    body = (await request.json()) as SharedOvertimePayload & {
      id?: string;
      employee_id?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  const employeeId = String(body.employee_id ?? "").trim();
  if (!id || !employeeId) {
    return NextResponse.json(
      { error: "Entry id and employee are required." },
      { status: 400 },
    );
  }

  const scopeError = await assertEmployeesAllowed(tenantId, [employeeId]);
  if (scopeError) {
    return scopeError;
  }

  const fields = parseSharedFields(body);
  if (!fields.day_type) {
    return NextResponse.json({ error: "Day type is required." }, { status: 400 });
  }

  const fieldErrors = validateOvertimeEntryInput({
    date: fields.date,
    hours_worked: fields.hours_worked,
    overtime_hours: fields.overtime_hours,
    overtime_rate: fields.overtime_rate,
    approved_by: fields.approved_by,
    day_type: fields.day_type,
  });
  if (Object.keys(fieldErrors).length > 0) {
    return validationErrorResponse(fieldErrors);
  }

  const payload = buildRowPayload(tenantId, employeeId, fields);

  const supabase = await getTenantSupabase();
  const { data: existing, error: fetchError } = await applyEmployeeIdScope(
    supabase
      .from("overtime_register")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", id),
    (await resolveAllowedEmployeeIds(tenantId)).employeeIds,
  ).maybeSingle();

  if (fetchError) {
    console.error("[overtime-register PATCH] fetch", fetchError);
    return NextResponse.json(
      { error: "Unable to load overtime entry." },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Overtime entry not found." },
      { status: 404 },
    );
  }

  const { error: updateError } = await supabase
    .from("overtime_register")
    .update({
      date: payload.date,
      employee_id: payload.employee_id,
      day_type: payload.day_type,
      hours_worked: payload.hours_worked,
      overtime_hours: payload.overtime_hours,
      overtime_rate: payload.overtime_rate,
      overtime_amount: payload.overtime_amount,
      approved_by: payload.approved_by,
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (updateError) {
    console.error("[overtime-register PATCH]", updateError);
    return NextResponse.json(
      { error: updateError.message || "Failed to update overtime entry." },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}
