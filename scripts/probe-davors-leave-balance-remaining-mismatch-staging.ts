/**
 * Read-only: days_remaining vs (entitled_days - days_used) for Davors tenant 2026.
 *   npx tsx scripts/probe-davors-leave-balance-remaining-mismatch-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";
const YEAR = 2026;

function toNum(value: unknown): number {
  return Number(value) || 0;
}

function mismatches(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) > 0.001;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: employees, error: employeesError } = await admin
    .from("employees")
    .select("employee_id, staff_id, full_name")
    .eq("tenant_id", DAVORS_TENANT);

  if (employeesError) {
    console.error("employees error:", employeesError.message);
    process.exit(1);
  }

  const employeeIds = (employees ?? []).map((row) => row.employee_id);
  if (employeeIds.length === 0) {
    console.log(JSON.stringify({ message: "No Davors employees found" }, null, 2));
    return;
  }

  const { data: balances, error: balancesError } = await admin
    .from("employee_leave_balances")
    .select(
      "employee_id, leave_type_id, entitled_days, days_used, days_remaining, leave_types(type_name)",
    )
    .eq("year", YEAR)
    .in("employee_id", employeeIds);

  if (balancesError) {
    console.error("balances error:", balancesError.message);
    process.exit(1);
  }

  const employeeMap = new Map(
    (employees ?? []).map((row) => [row.employee_id, row]),
  );

  const rows = balances ?? [];
  const badRows = rows
    .map((row) => {
      const entitled = toNum(row.entitled_days);
      const used = toNum(row.days_used);
      const remaining = toNum(row.days_remaining);
      const expected = entitled - used;
      const leaveType = Array.isArray(row.leave_types)
        ? row.leave_types[0]?.type_name
        : row.leave_types?.type_name;
      const employee = employeeMap.get(row.employee_id);

      return {
        employee_id: row.employee_id,
        staff_id: employee?.staff_id ?? null,
        full_name: employee?.full_name ?? null,
        leave_type: leaveType ?? null,
        entitled_days: entitled,
        days_used: used,
        days_remaining: remaining,
        expected_remaining: expected,
        delta: remaining - expected,
      };
    })
    .filter((row) => mismatches(row.expected_remaining, row.days_remaining));

  console.log(
    JSON.stringify(
      {
        tenant_id: DAVORS_TENANT,
        year: YEAR,
        total_rows: rows.length,
        mismatch_rows: badRows.length,
        mismatch_rate_pct:
          rows.length > 0
            ? Math.round((badRows.length / rows.length) * 1000) / 10
            : 0,
        distinct_employees_affected: new Set(badRows.map((r) => r.employee_id))
          .size,
        sample_mismatches: badRows.slice(0, 15),
      },
      null,
      2,
    ),
  );
}

void main();
