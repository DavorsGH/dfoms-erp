/**
 * Staging: simulate concurrent syncProcessingAllowanceLines (race fix validation).
 *
 * Usage:
 *   npx tsx scripts/test-payroll-allowance-lines-race-staging.ts
 *   npx tsx scripts/test-payroll-allowance-lines-race-staging.ts --tenant-id <uuid>
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { syncProcessingAllowanceLines } from "../app/dashboard/hr-payroll/payroll-allowance-lines-utils";
import {
  resolvePayrollPolicyCompensation,
  type PayrollCompensationPolicyConfig,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  getPeriodEndDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const FY = 2026;
const AUGUST = 8;

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

function parseArgs() {
  const args = process.argv.slice(2);
  let envFile = ".env.staging.local";
  let tenantId: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--tenant-id" && args[i + 1]) {
      tenantId = args[i + 1]!;
      i += 1;
    }
  }
  return { envFile, tenantId };
}

async function probeIntegrity(
  admin: SupabaseClient,
  tenantId: string,
  payrollMonth: string,
) {
  const { data: lines, error } = await admin
    .from("payroll_allowance_lines")
    .select("id, stage, employee_id, allowance_code")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth)
    .eq("stage", "processing");

  if (error) throw error;

  const rows = (lines ?? []) as Array<{
    id: string;
    stage: string;
    employee_id: string;
    allowance_code: string;
  }>;
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.employee_id}|${row.allowance_code}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  const dupes = [...byKey.entries()].filter(([, count]) => count > 1);

  const { count: processingCount } = await admin
    .from("payroll_processing")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  return {
    totalLines: rows.length,
    uniqueKeys: byKey.size,
    duplicateGroups: dupes.length,
    processingRows: processingCount ?? 0,
  };
}

async function main() {
  const { envFile, tenantId: argTenantId } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing non-staging URL (expected ${STAGING_REF})`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  let tenantId = argTenantId;
  if (!tenantId) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("id, name")
      .ilike("name", "%Davors%")
      .limit(1)
      .maybeSingle();
    if (!tenant) throw new Error("No tenant found");
    tenantId = tenant.id;
    console.log(`Using tenant: ${tenant.name} (${tenantId})`);
  }

  const period = resolveSelectedPeriod(FY, AUGUST);
  const payrollMonth = period.payrollMonth.slice(0, 10);

  const { data: openMonth } = await admin
    .from("month_end_close")
    .select("month, lock_status")
    .eq("tenant_id", tenantId)
    .eq("month", payrollMonth)
    .maybeSingle();

  if (openMonth && openMonth.lock_status !== "Open") {
    console.log(
      `Note: ${payrollMonth} lock_status=${openMonth.lock_status} (continuing anyway)`,
    );
  }

  const { data: employee, error: empError } = await admin
    .from("employees")
    .select(
      "employee_id, position, employment_type, shift",
    )
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();

  if (empError || !employee) {
    throw empError ?? new Error("No employee for tenant");
  }

  const [
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    { data: ssnitRows },
    { data: casualRows },
    { data: payeRows },
  ] = await Promise.all([
    admin.from("salary_rate_config").select("*").eq("tenant_id", tenantId),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", tenantId),
    admin.from("compensation_policy").select("*").eq("tenant_id", tenantId),
    admin.from("ssnit_rate_config").select("*").eq("tenant_id", tenantId),
    admin.from("casual_tax_rate_config").select("*").eq("tenant_id", tenantId),
    admin
      .from("paye_tax_bands")
      .select("band_order, lower_bound, upper_bound, rate, effective_date")
      .eq("tenant_id", tenantId),
  ]);

  const config: PayrollCompensationPolicyConfig = {
    salaryRates: salaryRates ?? [],
    allowanceTypes: allowanceTypes ?? [],
    compensationPolicies: compensationPolicies ?? [],
  };

  const policy = resolvePayrollPolicyCompensation(
    employee,
    config,
    new Date(getPeriodEndDate(period.year, period.month)),
  );

  if (!policy) {
    throw new Error("Could not resolve compensation policy for test employee");
  }

  console.log(`\n=== Allowance lines race test (${payrollMonth}) ===`);
  const before = await probeIntegrity(admin, tenantId, payrollMonth);
  console.log("Before:", before);

  const concurrency = 12;
  console.log(`\nFiring ${concurrency} concurrent syncProcessingAllowanceLines...`);
  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      syncProcessingAllowanceLines(
        admin,
        payrollMonth,
        employee.employee_id,
        policy.allowance_lines,
        { tenantId },
      ),
    ),
  );

  const errors = results.filter((r) => r.error).map((r) => r.error!);
  console.log(`Errors: ${errors.length}`);
  for (const err of errors.slice(0, 5)) {
    console.log(`  ${err}`);
  }

  const after = await probeIntegrity(admin, tenantId, payrollMonth);
  console.log("\nAfter:", after);

  const expectedLines = policy.allowance_lines.length;
  const employeeLines = after.totalLines;
  const pass =
    errors.length === 0 &&
    after.duplicateGroups === 0 &&
    employeeLines >= expectedLines;

  console.log(
    `\n=== Concurrent sync: ${pass ? "PASS" : "FAIL"} — errors=${errors.length}, dupes=${after.duplicateGroups} ===`,
  );

  // Stale-line cleanup: sync with one allowance omitted, then restore full set.
  if (policy.allowance_lines.length > 1) {
    const reduced = policy.allowance_lines.slice(1);
    const removedCode = policy.allowance_lines[0]!.allowance_code;
    const reducedResult = await syncProcessingAllowanceLines(
      admin,
      payrollMonth,
      employee.employee_id,
      reduced,
      { tenantId },
    );
    const { data: afterReduced } = await admin
      .from("payroll_allowance_lines")
      .select("allowance_code")
      .eq("tenant_id", tenantId)
      .eq("stage", "processing")
      .eq("payroll_month", payrollMonth)
      .eq("employee_id", employee.employee_id);

    const stillHasRemoved = (afterReduced ?? []).some(
      (row) => row.allowance_code === removedCode,
    );

    const restoreResult = await syncProcessingAllowanceLines(
      admin,
      payrollMonth,
      employee.employee_id,
      policy.allowance_lines,
      { tenantId },
    );

    const stalePass =
      !reducedResult.error &&
      !restoreResult.error &&
      !stillHasRemoved;

    console.log(
      `=== Stale allowance cleanup: ${stalePass ? "PASS" : "FAIL"} (removed code ${removedCode} cleared) ===\n`,
    );

    if (!stalePass) process.exit(1);
  }

  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
