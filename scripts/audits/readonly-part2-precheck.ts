/**
 * Read-only counts for Part 2 pre-test (staging + production).
 * npx tsx scripts/audits/readonly-part2-precheck.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function countLoans(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  label: string,
) {
  const { count, error } = await admin
    .from("loan_register")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) {
    console.log(`${label} loans: ERROR ${error.message}`);
    return;
  }
  console.log(`${label} loans: ${count ?? 0}`);
}

async function verifyPaymentAccountColumns(
  admin: ReturnType<typeof createClient>,
  label: string,
) {
  const { data, error } = await admin
    .from("payment_accounts")
    .select("id, account_name, bank_name, is_active")
    .limit(1);
  if (error) {
    console.log(`${label} payment_accounts select: ERROR ${error.message}`);
    return;
  }
  console.log(
    `${label} payment_accounts schema OK (sample rows: ${data?.length ?? 0})`,
  );
}

async function productionManualAdvances(admin: ReturnType<typeof createClient>) {
  const { data: openMonths, error: mecError } = await admin
    .from("month_end_close")
    .select("tenant_id, month, business_unit_id, lock_status")
    .not("lock_status", "in", "(Locked,Partially Locked)");

  if (mecError) {
    console.log(`Production open months: ERROR ${mecError.message}`);
    return;
  }

  const openKeys = new Set(
    (openMonths ?? []).map(
      (r) =>
        `${r.tenant_id}|${String(r.month).slice(0, 10)}|${r.business_unit_id ?? ""}`,
    ),
  );

  const { data: rows, error } = await admin
    .from("payroll_processing")
    .select("tenant_id, payroll_month, employee_id, salary_advance")
    .neq("salary_advance", 0);

  if (error) {
    console.log(`Production manual advances query: ERROR ${error.message}`);
    return;
  }

  const employeeIds = [...new Set((rows ?? []).map((r) => r.employee_id))];
  const { data: employees, error: empError } = await admin
    .from("employees")
    .select("tenant_id, employee_id, business_unit_id")
    .in("employee_id", employeeIds.length ? employeeIds : ["__none__"]);

  if (empError) {
    console.log(`Production employees for advances: ERROR ${empError.message}`);
    return;
  }

  const buByEmployee = new Map(
    (employees ?? []).map((e) => [
      `${e.tenant_id}|${e.employee_id}`,
      (e.business_unit_id as string | null) ?? null,
    ]),
  );

  const openRows = (rows ?? []).filter((row) => {
    const month = String(row.payroll_month).slice(0, 10);
    const empBu =
      buByEmployee.get(`${row.tenant_id}|${row.employee_id}`) ?? null;
    const keyWithBu = `${row.tenant_id}|${month}|${empBu ?? ""}`;
    const keyTenantWide = `${row.tenant_id}|${month}|`;
    return openKeys.has(keyWithBu) || openKeys.has(keyTenantWide);
  });

  console.log(
    `\nProduction open-month payroll_processing with salary_advance <> 0: ${openRows.length}`,
  );
  for (const row of openRows.slice(0, 50)) {
    console.log(
      `  tenant=${row.tenant_id} month=${String(row.payroll_month).slice(0, 10)} employee=${row.employee_id} amount=${row.salary_advance}`,
    );
  }
  if (openRows.length > 50) {
    console.log(`  … and ${openRows.length - 50} more`);
  }
}

async function main() {
  const root = resolve(import.meta.dirname, "../..");

  loadEnv(resolve(root, ".env.staging.local"));
  const stagingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const staging = createClient(stagingUrl, stagingKey, {
    auth: { persistSession: false },
  });

  console.log("=== STAGING ===");
  await verifyPaymentAccountColumns(staging, "staging");
  await countLoans(staging, DAVORS, "Davors");
  await countLoans(staging, CAANTA, "Caanta");

  loadEnv(resolve(root, ".env.local.production-backup-2026-08-25"));
  const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const prod = createClient(prodUrl, prodKey, {
    auth: { persistSession: false },
  });

  console.log("\n=== PRODUCTION (read-only) ===");
  await verifyPaymentAccountColumns(prod, "production");
  await productionManualAdvances(prod);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
