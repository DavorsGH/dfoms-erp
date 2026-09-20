import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const tenantId = "00000001-0000-4000-8000-000000000001";
const year = new Date().getFullYear();

async function main() {
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count, error: countError } = await admin
    .from("employee_leave_balances")
    .select("*", { count: "exact", head: true });

  const { data: rows, error } = await admin
    .from("employee_leave_balances")
    .select(
      "employee_id, entitled_days, days_used, days_remaining, leave_types(type_name), employees!employee_leave_balances_employee_id_fkey(full_name, staff_id, tenant_id)",
    )
    .eq("year", year)
    .gt("entitled_days", 0)
    .order("days_remaining", { ascending: false })
    .limit(50);

  if (error || countError) {
    console.error("ERROR", error?.message ?? countError?.message);
    process.exit(1);
  }

  const scoped = (rows ?? []).filter((row) => {
    const employee = Array.isArray(row.employees)
      ? row.employees[0]
      : row.employees;
    return employee?.tenant_id === tenantId;
  });

  const sample = scoped[0] ?? rows?.[0] ?? null;
  if (!sample) {
    console.log(
      JSON.stringify(
        { year, totalRowsInDatabase: count, message: "No entitlement rows in database" },
        null,
        2,
      ),
    );
    return;
  }

  const employee = Array.isArray(sample.employees)
    ? sample.employees[0]
    : sample.employees;
  const leaveType = Array.isArray(sample.leave_types)
    ? sample.leave_types[0]
    : sample.leave_types;

  const { data: allForEmployee, error: employeeError } = await admin
    .from("employee_leave_balances")
    .select("*, leave_types(type_name)")
    .eq("employee_id", sample.employee_id)
    .eq("year", year)
    .order("leave_type_id");

  if (employeeError) {
    console.error("employee query ERROR", employeeError.message);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        year,
        totalRowsInDatabase: count,
        davorsTenantRowCount: scoped.length,
        probeEmployee: {
          employeeId: sample.employee_id,
          staffId: employee?.staff_id,
          fullName: employee?.full_name,
          tenantId: employee?.tenant_id,
        },
        toolShapePreview: {
          year,
          balances: (allForEmployee ?? []).map((row) => {
            const type = Array.isArray(row.leave_types)
              ? row.leave_types[0]
              : row.leave_types;
            return {
              leaveType: type?.type_name,
              entitledDays: Number(row.entitled_days) || 0,
              daysUsed: Number(row.days_used) || 0,
              daysRemaining: Number(row.days_remaining) || 0,
            };
          }),
        },
        arithmeticCheck:
          allForEmployee?.map((row) => ({
            leaveType: (Array.isArray(row.leave_types)
              ? row.leave_types[0]
              : row.leave_types)?.type_name,
            entitledMinusUsed:
              (Number(row.entitled_days) || 0) - (Number(row.days_used) || 0),
            storedRemaining: Number(row.days_remaining) || 0,
            matches:
              Math.abs(
                (Number(row.entitled_days) || 0) -
                  (Number(row.days_used) || 0) -
                  (Number(row.days_remaining) || 0),
              ) < 0.001,
          })) ?? [],
      },
      null,
      2,
    ),
  );
}

void main();
