// @ts-nocheck
/**
 * Probe which payroll_processing ON CONFLICT target exists (staging + production).
 * Read-mostly: inserts a probe row only if upsert succeeds, then deletes it.
 *
 *   npx tsx --env-file .env.local.backup scripts/_probe-payroll-on-conflict.ts
 *   npx tsx --env-file .env.staging.local scripts/_probe-payroll-on-conflict.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return false;
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
  return true;
}

const envFile = process.argv[2] ?? ".env.local.backup";
loadEnv(resolve(envFile));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
console.log("envFile", envFile);
console.log("URL", url);

const admin = createClient(url, key, { auth: { persistSession: false } });
const TENANT = "00000001-0000-4000-8000-000000000001";

async function main() {
  // List constraints via pg_catalog if a helper exists; else trial upserts.
  const { data: emp } = await admin
    .from("employees")
    .select("employee_id, staff_id, date_hired, employment_status, full_name")
    .eq("tenant_id", TENANT)
    .eq("staff_id", "DF0026")
    .maybeSingle();
  console.log("DF0026:", emp);

  const { data: julyRows, error: julyErr } = await admin
    .from("payroll_processing")
    .select("id, employee_id, days_to_pay, payroll_month")
    .eq("tenant_id", TENANT)
    .eq("payroll_month", "2026-07-01");
  console.log("July processing count:", julyRows?.length, julyErr?.message);

  const { count: activeCount } = await admin
    .from("employees")
    .select("employee_id", { count: "exact", head: true })
    .eq("tenant_id", TENANT)
    .eq("employment_status", "Active");
  console.log("Active employees:", activeCount);

  // Find a real employee to use for conflict probe (won't leave junk if we use fake month)
  const { data: anyEmp } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", TENANT)
    .limit(1)
    .maybeSingle();

  if (!anyEmp) {
    console.log("No employees — cannot probe upsert");
    return;
  }

  const payload = {
    tenant_id: TENANT,
    payroll_month: "2099-01-01",
    employee_id: anyEmp.employee_id,
    days_to_pay: 1,
    status: "Draft",
    basic_salary: 0,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowances: 0,
    overtime_amount: 0,
    bonuses: 0,
    arrears: 0,
    gross_pay: 0,
    employee_ssnit: 0,
    employer_ssnit: 0,
    tier2: 0,
    tier3: 0,
    paye_tax: 0,
    loan_repayment: 0,
    salary_advance: 0,
    welfare_deduction: 0,
    other_deductions: 0,
    absence_deduction: 0,
    total_deductions: 0,
    net_pay: 0,
    daily_rate: 0,
    net_only_adjustment: 0,
  };

  const candidates = [
    "payroll_month,employee_id",
    "tenant_id,payroll_month,employee_id",
    "tenant_id,employee_id,payroll_month",
  ];

  for (const onConflict of candidates) {
    const { data, error } = await admin
      .from("payroll_processing")
      .upsert(payload, { onConflict, ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    console.log(
      `onConflict="${onConflict}" =>`,
      error ? `ERROR: ${error.message} / ${error.code}` : `OK id=${data?.id}`,
    );
  }

  // Cleanup any probe rows
  const { error: delErr, count } = await admin
    .from("payroll_processing")
    .delete({ count: "exact" })
    .eq("tenant_id", TENANT)
    .eq("payroll_month", "2099-01-01");
  console.log("cleanup deleted", count, delErr?.message ?? "ok");

  // Also try to read constraint names via a REST-exposed view if any
  const { data: indexes, error: idxErr } = await admin
    .from("pg_indexes")
    .select("*")
    .eq("tablename", "payroll_processing");
  console.log("pg_indexes via API:", idxErr?.message ?? indexes);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
