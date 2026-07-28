/**
 * Staging: Directory list Basic/Gross live-resolve from Salary Settings.
 *
 *   npx tsx scripts/test-directory-live-salary-staging.ts --env-file .env.staging.local
 *
 * Temporarily bumps one allowance matrix amount, asserts all employees in that
 * Position×Type×Shift combo reflect the new live gross, then restores.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { EMPLOYEE_SELECT } from "../app/dashboard/employees/employee-record-utils";
import { loadEmployeePayConfig } from "../app/dashboard/employees/lookup-utils";
import { resolveEmployeeCompensation } from "../app/dashboard/administration/compensation-policy-utils";
import { calculateGrossMonthlyPay } from "../app/dashboard/employees/pay-estimate-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const BUMP = 25;

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function almostEqual(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function resolveEnvFile(argv) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return ".env.staging.local";
}

function categoryKey(emp) {
  return `${emp.position ?? ""}|${emp.employment_type ?? ""}|${emp.shift ?? ""}`;
}

function liveFor(emp, payConfig) {
  return resolveEmployeeCompensation(
    payConfig.salaryRates,
    payConfig.compensationPolicies,
    payConfig.allowanceTypes,
    emp.position,
    emp.employment_type,
    emp.shift,
  );
}

async function main() {
  const envFile = resolveEnvFile(process.argv.slice(2));
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging URL: ${url}`);
  assert(key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: employees, error: empErr } = await admin
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .eq("tenant_id", DAVORS)
    .order("staff_id", { ascending: true });
  assert(!empErr, empErr?.message ?? "employees fetch failed");
  assert((employees?.length ?? 0) > 0, "No Davors employees");

  const t0 = Date.now();
  const payConfig = await loadEmployeePayConfig(admin, DAVORS);
  const liveMap = {};
  for (const emp of employees) {
    liveMap[emp.employee_id] = liveFor(emp, payConfig);
  }
  const elapsedMs = Date.now() - t0;
  console.log(
    `Batch payConfig + live-resolve for ${employees.length} employees in ${elapsedMs}ms ` +
      `(rates=${payConfig.salaryRates.length}, policies=${payConfig.compensationPolicies.length})`,
  );
  assert(elapsedMs < 10000, `Load too slow: ${elapsedMs}ms`);

  // Same-category employees must share identical live basic + gross
  const byCategory = new Map();
  for (const emp of employees) {
    const key = categoryKey(emp);
    if (!key.split("|").every(Boolean)) continue;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(emp);
  }

  let multiCategory = null;
  for (const [key, group] of byCategory) {
    if (group.length < 2) continue;
    const first = liveMap[group[0].employee_id];
    for (const emp of group) {
      const live = liveMap[emp.employee_id];
      assert(
        almostEqual(live.basic_salary, first.basic_salary),
        `${key}: ${emp.staff_id} basic ${live.basic_salary} != ${first.basic_salary}`,
      );
      assert(
        almostEqual(live.gross_monthly, first.gross_monthly),
        `${key}: ${emp.staff_id} gross ${live.gross_monthly} != ${first.gross_monthly}`,
      );
    }
    if (!multiCategory) multiCategory = { key, group, live: first };
  }
  assert(multiCategory, "Need a Position×Type×Shift with ≥2 employees to test");
  console.log(
    `PASS same-category identical live pay — ${multiCategory.key} (${multiCategory.group.length} employees) ` +
      `basic=${multiCategory.live.basic_salary} gross=${multiCategory.live.gross_monthly}`,
  );

  // Show stamped vs live divergence if any (the bug David reported)
  let staleCount = 0;
  for (const emp of employees) {
    const live = liveMap[emp.employee_id];
    const stampedGross = calculateGrossMonthlyPay({
      basic_salary: emp.basic_salary,
      housing_allowance: emp.housing_allowance,
      transport_allowance: emp.transport_allowance,
      other_allowances: emp.other_allowances,
    });
    if (
      !almostEqual(Number(emp.basic_salary) || 0, live.basic_salary) ||
      !almostEqual(stampedGross, live.gross_monthly)
    ) {
      staleCount += 1;
    }
  }
  console.log(
    `Info: ${staleCount}/${employees.length} employees have stamped pay ≠ live policy (list would have been stale before fix)`,
  );

  // Mutate one allowance policy row for the multi category, re-resolve, restore
  const [pos, empType, sh] = multiCategory.key.split("|");
  const { data: policyRows, error: polErr } = await admin
    .from("compensation_policy")
    .select("id, amount, position, employment_type, shift, allowance_type_id")
    .eq("tenant_id", DAVORS)
    .eq("position", pos)
    .eq("employment_type", empType)
    .eq("shift", sh)
    .limit(1);
  assert(!polErr, polErr?.message ?? "policy fetch failed");
  assert((policyRows?.length ?? 0) > 0, `No allowance policy row for ${multiCategory.key}`);

  const target = policyRows[0];
  const originalAmount = Number(target.amount) || 0;
  const bumped = originalAmount + BUMP;

  try {
    const { error: updErr } = await admin
      .from("compensation_policy")
      .update({ amount: bumped })
      .eq("id", target.id);
    assert(!updErr, updErr?.message ?? "policy update failed");

    const payConfigAfter = await loadEmployeePayConfig(admin, DAVORS);
    const expectedGross = multiCategory.live.gross_monthly + BUMP;

    for (const emp of multiCategory.group) {
      const live = liveFor(emp, payConfigAfter);
      assert(
        almostEqual(live.gross_monthly, expectedGross),
        `${emp.staff_id} live gross ${live.gross_monthly} != expected ${expectedGross} after policy bump`,
      );
      // Stamped columns should NOT change (no employee re-save)
      const stampedGross = calculateGrossMonthlyPay({
        basic_salary: emp.basic_salary,
        housing_allowance: emp.housing_allowance,
        transport_allowance: emp.transport_allowance,
        other_allowances: emp.other_allowances,
      });
      assert(
        !almostEqual(stampedGross, expectedGross) ||
          almostEqual(stampedGross, multiCategory.live.gross_monthly + BUMP),
        "unexpected stamped equality check",
      );
      // If there was already divergence, stamped stays old; live must be new.
      assert(
        almostEqual(live.gross_monthly, expectedGross),
        "live must pick up bump without re-save",
      );
    }
    console.log(
      `PASS policy bump +${BUMP} on allowance id=${target.id}: all ${multiCategory.group.length} category employees live gross → ${expectedGross} without re-save`,
    );
  } finally {
    const { error: restoreErr } = await admin
      .from("compensation_policy")
      .update({ amount: originalAmount })
      .eq("id", target.id);
    if (restoreErr) {
      console.error("RESTORE FAILED:", restoreErr.message, {
        id: target.id,
        originalAmount,
      });
      throw restoreErr;
    }
    console.log(
      `Restored compensation_policy ${target.id} amount → ${originalAmount}`,
    );
  }

  console.log("\nAll directory live-salary staging checks passed.");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
