/**
 * Read-only: inspect payroll_allowance_lines for duplicate-key risk (Aug 2026 Davors).
 *
 * Usage:
 *   npx tsx scripts/probe-payroll-allowance-lines-production.ts --env-file .env.local.backup
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const AUG_2026 = "2026-08-01";

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
  let envFile = ".env.local.backup";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1]!;
      i += 1;
    }
  }
  return { envFile };
}

async function main() {
  const { envFile } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL (expected ref ${PRODUCTION_REF})`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: lines, error } = await admin
    .from("payroll_allowance_lines")
    .select(
      "id, stage, payroll_month, employee_id, allowance_code, allowance_name, amount, created_at, updated_at",
    )
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", AUG_2026)
    .order("employee_id")
    .order("stage")
    .order("allowance_code");

  if (error) throw error;

  const rows = lines ?? [];
  console.log(`\n=== payroll_allowance_lines Davors ${AUG_2026} ===`);
  console.log(`Total rows: ${rows.length}`);

  const byKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.stage}|${row.employee_id}|${row.allowance_code}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push(row);
    byKey.set(key, bucket);
  }

  const dupGroups = [...byKey.entries()].filter(([, g]) => g.length > 1);
  console.log(`Unique (stage, employee_id, allowance_code) keys: ${byKey.size}`);
  console.log(`Duplicate groups (constraint violation if inserted again): ${dupGroups.length}`);

  if (dupGroups.length > 0) {
    console.log("\n--- Duplicate groups ---");
    for (const [key, group] of dupGroups.slice(0, 20)) {
      console.log(`  ${key} (${group.length} rows)`);
      for (const r of group) {
        console.log(
          `    id=${r.id} amount=${r.amount} created=${r.created_at}`,
        );
      }
    }
  }

  const processing = rows.filter((r) => r.stage === "processing");
  const history = rows.filter((r) => r.stage === "history");
  console.log(`\nBy stage: processing=${processing.length} history=${history.length}`);

  const { data: closeRow } = await admin
    .from("month_end_close")
    .select("month, lock_status, employees_recorded")
    .eq("tenant_id", DAVORS)
    .eq("month", AUG_2026)
    .maybeSingle();
  console.log(`\nmonth_end_close Aug 2026: ${JSON.stringify(closeRow)}`);

  const { count: employeeCount } = await admin
    .from("payroll_processing")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", AUG_2026);
  console.log(`payroll_processing rows Aug 2026: ${employeeCount ?? 0}`);

  const { data: allowanceTypes } = await admin
    .from("allowance_types")
    .select("id, code, name, is_active")
    .eq("tenant_id", DAVORS)
    .order("code");
  console.log(`\nActive allowance types: ${(allowanceTypes ?? []).filter((t) => t.is_active).length}`);

  const codes = (allowanceTypes ?? []).map((t) => t.code);
  const codeSet = new Set(codes);
  if (codes.length !== codeSet.size) {
    console.log("WARNING: duplicate allowance_types.code values in catalog");
  }

  const employeesInPeriod = new Set(processing.map((r) => r.employee_id));
  let policyDupEmployees = 0;
  for (const empId of employeesInPeriod) {
    const empLines = processing.filter((r) => r.employee_id === empId);
    const empCodes = empLines.map((r) => r.allowance_code);
    if (empCodes.length !== new Set(empCodes).size) policyDupEmployees += 1;
  }
  console.log(
    `Employees with duplicate processing allowance_code rows already stored: ${policyDupEmployees}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
