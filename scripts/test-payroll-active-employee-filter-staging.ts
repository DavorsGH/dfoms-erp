/**
 * Staging: payroll roster excludes Inactive employees platform-wide.
 *
 *   npx tsx scripts/test-payroll-active-employee-filter-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import {
  filterEmployeesForPayrollPeriod,
  isEligibleForPayrollProcessing,
  wasEmployedDuringPayrollPeriod,
} from "../app/dashboard/hr-payroll/employee-utils";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

type EmployeeRow = {
  tenant_id: string;
  employee_id: string;
  staff_id: string;
  full_name: string;
  employment_status: string | null;
  date_hired: string | null;
  appointment_end_date: string | null;
};

async function verifyTenant(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  tenantLabel: string,
  year: number,
  month: number,
) {
  const { data, error } = await admin
    .from("employees")
    .select(
      "tenant_id, employee_id, staff_id, full_name, employment_status, date_hired, appointment_end_date",
    )
    .eq("tenant_id", tenantId);

  assert(!error, `${tenantLabel}: ${error?.message ?? "employees fetch failed"}`);

  const employees = (data as EmployeeRow[] | null) ?? [];
  const dateEligible = employees.filter((row) =>
    wasEmployedDuringPayrollPeriod(row, year, month),
  );
  const payrollEligible = filterEmployeesForPayrollPeriod(employees, year, month);

  const inactiveInPayroll = payrollEligible.filter(
    (row) => (row.employment_status ?? "").trim().toLowerCase() === "inactive",
  );
  const inactiveInDateOnly = dateEligible.filter(
    (row) => (row.employment_status ?? "").trim().toLowerCase() === "inactive",
  );

  console.log(`\n[${tenantLabel}] ${year}-${String(month).padStart(2, "0")}`);
  console.log(`  total employees: ${employees.length}`);
  console.log(`  date-eligible (old logic): ${dateEligible.length}`);
  console.log(`  payroll-eligible (Active + mid-month Terminated): ${payrollEligible.length}`);
  console.log(
    `  inactive excluded: ${inactiveInDateOnly.length} would have appeared before fix`,
  );

  assert(
    inactiveInPayroll.length === 0,
    `${tenantLabel}: Inactive employee(s) in payroll roster: ${inactiveInPayroll.map((r) => r.staff_id).join(", ")}`,
  );

  for (const row of payrollEligible) {
    assert(
      isEligibleForPayrollProcessing(row, year, month),
      `${tenantLabel}: ${row.staff_id} failed isEligibleForPayrollProcessing`,
    );
  }

  console.log(`  PASS — no Inactive employees in payroll roster`);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging URL: ${url}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenants, error: tenantsError } = await admin
    .from("tenants")
    .select("id, name, slug")
    .eq("status", "active")
    .order("name", { ascending: true });

  assert(!tenantsError, tenantsError?.message ?? "tenants fetch failed");
  assert(tenants && tenants.length > 0, "No active tenants on staging");

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  console.log(`=== Payroll active-employee filter (staging, ${tenants.length} tenants) ===`);

  for (const tenant of tenants) {
    await verifyTenant(
      admin,
      tenant.id,
      `${tenant.name} (${tenant.slug})`,
      year,
      month,
    );
  }

  // Synthetic mid-month termination must remain eligible when end date is in-period.
  const syntheticOk = isEligibleForPayrollProcessing(
    {
      employment_status: "Terminated",
      date_hired: "2020-01-01",
      appointment_end_date: `${year}-${String(month).padStart(2, "0")}-15`,
    },
    year,
    month,
  );
  assert(syntheticOk, "Mid-month Terminated employee should remain payroll-eligible");

  const syntheticInactive = isEligibleForPayrollProcessing(
    {
      employment_status: "Inactive",
      date_hired: "2020-01-01",
      appointment_end_date: null,
    },
    year,
    month,
  );
  assert(!syntheticInactive, "Inactive employee must never be payroll-eligible");

  console.log("\nSynthetic edge cases: PASS");
  console.log(`\n${tenants.length}/${tenants.length} tenants passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
