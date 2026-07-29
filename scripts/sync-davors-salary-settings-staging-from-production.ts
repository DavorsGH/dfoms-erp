/**
 * Sync Davors Salary Settings from production → staging.
 * Updates allowance_types (by code), salary_rate_config, compensation_policy.
 * Does NOT touch Caanta. Preserves staging allowance_type ids; remaps policy FKs by code.
 *
 *   npx tsx scripts/sync-davors-salary-settings-staging-from-production.ts --dry-run
 *   npx tsx scripts/sync-davors-salary-settings-staging-from-production.ts --apply
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvFile(filePath) {
  const env = {};
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
    env[trimmed.slice(0, i).trim()] = value;
  }
  return env;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function almostEqual(a, b, eps = 0.001) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function rateKey(row) {
  return [
    row.position,
    row.employment_type,
    row.shift,
    String(row.effective_date).slice(0, 10),
  ].join("|");
}

function policyKey(row, code) {
  return [row.position, row.employment_type, row.shift, code].join("|");
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const prodEnv = loadEnvFile(resolve(".env.local.backup"));
  const stgEnv = loadEnvFile(resolve(".env.staging.local"));
  assert(
    (prodEnv.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCTION_REF),
    "Production env missing/wrong ref",
  );
  assert(
    (stgEnv.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(STAGING_REF),
    "Staging env missing/wrong ref",
  );

  const prod = createClient(
    prodEnv.NEXT_PUBLIC_SUPABASE_URL,
    prodEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const stg = createClient(
    stgEnv.NEXT_PUBLIC_SUPABASE_URL,
    stgEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  console.log(
    `Mode: ${apply ? "APPLY" : "DRY-RUN"} | Davors only | prod→staging Salary Settings sync`,
  );

  const [
    { data: prodTypes, error: e1 },
    { data: stgTypes, error: e2 },
    { data: prodRates, error: e3 },
    { data: stgRates, error: e4 },
    { data: prodPolicies, error: e5 },
    { data: stgPolicies, error: e6 },
  ] = await Promise.all([
    prod
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", DAVORS),
    stg
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", DAVORS),
    prod.from("salary_rate_config").select("*").eq("tenant_id", DAVORS),
    stg.from("salary_rate_config").select("*").eq("tenant_id", DAVORS),
    prod.from("compensation_policy").select("*").eq("tenant_id", DAVORS),
    stg.from("compensation_policy").select("*").eq("tenant_id", DAVORS),
  ]);
  assert(!e1 && !e2 && !e3 && !e4 && !e5 && !e6, "Fetch failed");

  const prodTypeByCode = new Map((prodTypes ?? []).map((t) => [t.code, t]));
  const stgTypeByCode = new Map((stgTypes ?? []).map((t) => [t.code, t]));
  const prodTypeById = new Map((prodTypes ?? []).map((t) => [t.id, t]));
  const stgTypeById = new Map((stgTypes ?? []).map((t) => [t.id, t]));

  const actions = {
    typeUpdates: [],
    typeInserts: [],
    rateUpdates: [],
    rateInserts: [],
    policyUpdates: [],
    policyInserts: [],
  };

  // --- allowance_types by code ---
  for (const [code, p] of prodTypeByCode) {
    const s = stgTypeByCode.get(code);
    if (!s) {
      actions.typeInserts.push({
        tenant_id: DAVORS,
        code: p.code,
        name: p.name,
        is_active: p.is_active,
        sort_order: p.sort_order,
      });
      continue;
    }
    if (
      s.name !== p.name ||
      Boolean(s.is_active) !== Boolean(p.is_active) ||
      Number(s.sort_order) !== Number(p.sort_order)
    ) {
      actions.typeUpdates.push({
        id: s.id,
        before: { name: s.name, is_active: s.is_active, sort_order: s.sort_order },
        after: {
          name: p.name,
          is_active: p.is_active,
          sort_order: p.sort_order,
        },
      });
    }
  }

  // --- salary_rate_config ---
  const stgRateByKey = new Map((stgRates ?? []).map((r) => [rateKey(r), r]));
  for (const p of prodRates ?? []) {
    const key = rateKey(p);
    const s = stgRateByKey.get(key);
    if (!s) {
      actions.rateInserts.push({
        tenant_id: DAVORS,
        position: p.position,
        employment_type: p.employment_type,
        shift: p.shift,
        basic_salary: p.basic_salary,
        effective_date: String(p.effective_date).slice(0, 10),
      });
      continue;
    }
    if (!almostEqual(s.basic_salary, p.basic_salary)) {
      actions.rateUpdates.push({
        id: s.id,
        key,
        before: Number(s.basic_salary),
        after: Number(p.basic_salary),
      });
    }
  }

  // --- compensation_policy (match by position/type/shift/code) ---
  const stgPolicyByKey = new Map();
  for (const s of stgPolicies ?? []) {
    const code = stgTypeById.get(s.allowance_type_id)?.code;
    if (!code) continue;
    stgPolicyByKey.set(policyKey(s, code), s);
  }

  for (const p of prodPolicies ?? []) {
    const code = prodTypeById.get(p.allowance_type_id)?.code;
    assert(code, `Prod policy ${p.id} missing allowance type`);
    const key = policyKey(p, code);
    const s = stgPolicyByKey.get(key);
    const stgType = stgTypeByCode.get(code);
    // If type not on staging yet, insert will happen first; remap after apply.
    if (!s) {
      actions.policyInserts.push({
        key,
        code,
        tenant_id: DAVORS,
        position: p.position,
        employment_type: p.employment_type,
        shift: p.shift,
        amount: p.amount,
        notes: p.notes ?? null,
        // allowance_type_id filled at apply time from staging code map
      });
      continue;
    }
    if (!almostEqual(s.amount, p.amount) || (s.notes ?? "") !== (p.notes ?? "")) {
      actions.policyUpdates.push({
        id: s.id,
        key,
        before: { amount: Number(s.amount), notes: s.notes },
        after: { amount: Number(p.amount), notes: p.notes ?? null },
      });
    }
  }

  console.log("\n=== DIFF / PLANNED ACTIONS ===");
  console.log(`allowance_types updates: ${actions.typeUpdates.length}`);
  for (const u of actions.typeUpdates) {
    console.log(
      `  UPDATE ${u.id}: name "${u.before.name}" → "${u.after.name}", active ${u.before.is_active}→${u.after.is_active}, sort ${u.before.sort_order}→${u.after.sort_order}`,
    );
  }
  console.log(`allowance_types inserts: ${actions.typeInserts.length}`);
  for (const i of actions.typeInserts) console.log(`  INSERT code=${i.code} name=${i.name}`);

  console.log(`salary_rate_config updates: ${actions.rateUpdates.length}`);
  for (const u of actions.rateUpdates) {
    console.log(`  UPDATE ${u.key}: ${u.before} → ${u.after}`);
  }
  console.log(`salary_rate_config inserts: ${actions.rateInserts.length}`);
  for (const i of actions.rateInserts) {
    console.log(
      `  INSERT ${i.position}|${i.employment_type}|${i.shift}|${i.effective_date} basic=${i.basic_salary}`,
    );
  }

  console.log(`compensation_policy updates: ${actions.policyUpdates.length}`);
  for (const u of actions.policyUpdates) {
    console.log(
      `  UPDATE ${u.key}: amount ${u.before.amount} → ${u.after.amount}`,
    );
  }
  console.log(`compensation_policy inserts: ${actions.policyInserts.length}`);
  for (const i of actions.policyInserts) {
    console.log(`  INSERT ${i.key} amount=${i.amount}`);
  }

  const highlight =
    actions.policyUpdates.find((u) =>
      u.key.includes("Cleaning Supervisors|Full-Time|Full Day|SUPERVISOR"),
    ) ??
    actions.policyInserts.find((i) =>
      i.key.includes("Cleaning Supervisors|Full-Time|Full Day|SUPERVISOR"),
    );
  const stgSuper = stgPolicyByKey.get(
    "Cleaning Supervisors|Full-Time|Full Day|SUPERVISOR",
  );
  const prodSuper = [...(prodPolicies ?? [])].find((p) => {
    const code = prodTypeById.get(p.allowance_type_id)?.code;
    return (
      code === "SUPERVISOR" &&
      p.position === "Cleaning Supervisors" &&
      p.employment_type === "Full-Time" &&
      p.shift === "Full Day"
    );
  });
  console.log(
    `\nCleaning Supervisors|Full-Time|Full Day|SUPERVISOR: prod=${prodSuper?.amount} staging=${stgSuper?.amount} plannedChange=${highlight ? "yes" : "none (already match)"}`,
  );

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write staging.");
    return;
  }

  for (const u of actions.typeUpdates) {
    const { error } = await stg
      .from("allowance_types")
      .update(u.after)
      .eq("id", u.id)
      .eq("tenant_id", DAVORS);
    assert(!error, error?.message ?? "type update failed");
  }
  if (actions.typeInserts.length) {
    const { error } = await stg.from("allowance_types").insert(actions.typeInserts);
    assert(!error, error?.message ?? "type insert failed");
  }

  // Refresh staging type map after type writes
  const { data: stgTypes2 } = await stg
    .from("allowance_types")
    .select("id, code, name, is_active, sort_order")
    .eq("tenant_id", DAVORS);
  const stgTypeByCode2 = new Map((stgTypes2 ?? []).map((t) => [t.code, t]));

  for (const u of actions.rateUpdates) {
    const { error } = await stg
      .from("salary_rate_config")
      .update({ basic_salary: u.after })
      .eq("id", u.id)
      .eq("tenant_id", DAVORS);
    assert(!error, error?.message ?? "rate update failed");
  }
  if (actions.rateInserts.length) {
    const { error } = await stg
      .from("salary_rate_config")
      .insert(actions.rateInserts);
    assert(!error, error?.message ?? "rate insert failed");
  }

  for (const u of actions.policyUpdates) {
    const { error } = await stg
      .from("compensation_policy")
      .update({ amount: u.after.amount, notes: u.after.notes })
      .eq("id", u.id)
      .eq("tenant_id", DAVORS);
    assert(!error, error?.message ?? "policy update failed");
  }
  if (actions.policyInserts.length) {
    const rows = actions.policyInserts.map((i) => {
      const type = stgTypeByCode2.get(i.code);
      assert(type, `Missing staging allowance_type for ${i.code}`);
      return {
        tenant_id: DAVORS,
        position: i.position,
        employment_type: i.employment_type,
        shift: i.shift,
        allowance_type_id: type.id,
        amount: i.amount,
        notes: i.notes,
      };
    });
    const { error } = await stg.from("compensation_policy").insert(rows);
    assert(!error, error?.message ?? "policy insert failed");
  }

  console.log("\nStaging Salary Settings sync applied (Davors only).");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
