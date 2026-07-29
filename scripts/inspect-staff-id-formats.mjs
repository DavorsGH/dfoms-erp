/**
 * Read-only: staff_id inventory + FK probe for employees.staff_id references.
 * Usage:
 *   node scripts/inspect-staff-id-formats.mjs staging
 *   node scripts/inspect-staff-id-formats.mjs production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envName = process.argv[2] || "staging";
const envFileArg = process.argv[3];
const envFile =
  envFileArg ||
  (envName === "production" ? ".env.production.local" : ".env.staging.local");
const expectedRef =
  envName === "production" ? "tvcurcnmasnocwdxzgvz" : "wieflwbfdmjtsdnwbfii";

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

loadEnvForce(resolve(process.cwd(), envFile));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url.includes(expectedRef)) {
  throw new Error(`Refusing: expected ${expectedRef}, got ${url}`);
}
if (!key) throw new Error("Missing service role key");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function classifyStaffId(staffId) {
  const s = staffId ?? "";
  if (/^DF\d{4}$/i.test(s)) return "legacy_DF####";
  if (/^DF-STAFF-\d+$/i.test(s)) return "new_DF-STAFF-####";
  if (/^[A-Z0-9]+-STAFF-\d+$/i.test(s)) return "new_TENANT-STAFF-####";
  if (/^CAN-STAFF-\d+$/i.test(s)) return "new_CAN-STAFF-####";
  return "other";
}

const { data: employees, error } = await supabase
  .from("employees")
  .select("tenant_id, employee_id, staff_id, full_name, employment_status")
  .order("staff_id", { ascending: true });
if (error) throw new Error(error.message);

const { data: tenants } = await supabase.from("tenants").select("id, name");
const tenantName = Object.fromEntries((tenants ?? []).map((t) => [t.id, t.name]));

const byClass = {};
for (const row of employees ?? []) {
  const cls = classifyStaffId(row.staff_id);
  byClass[cls] = (byClass[cls] ?? 0) + 1;
}

console.log(`\n=== ${envName.toUpperCase()} employees.staff_id (${employees.length}) ===`);
console.log("by_format:", byClass);
console.log("\nstaff_id | employee_id | tenant | status | full_name");
for (const row of employees ?? []) {
  const cls = classifyStaffId(row.staff_id);
  console.log(
    `${row.staff_id}\t${row.employee_id}\t${tenantName[row.tenant_id] ?? row.tenant_id}\t${row.employment_status ?? ""}\t${row.full_name}\t[${cls}]`,
  );
}

// attendance_register distinct staff_ids + counts
const { data: att, error: attErr } = await supabase
  .from("attendance_register")
  .select("staff_id, tenant_id");
if (attErr) {
  console.log("attendance query error:", attErr.message);
} else {
  const counts = new Map();
  for (const row of att ?? []) {
    const key = `${row.tenant_id}|${row.staff_id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log(`\n=== ${envName.toUpperCase()} attendance_register.staff_id usage (${att.length} rows, ${counts.size} distinct) ===`);
  for (const [key, count] of [...counts.entries()].sort()) {
    const [tenantId, staffId] = key.split("|");
    console.log(
      `${staffId}\t${count}\t${tenantName[tenantId] ?? tenantId}\t[${classifyStaffId(staffId)}]`,
    );
  }
}

// OpenAPI: look for FK descriptions mentioning staff_id
const open = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/openapi+json",
  },
});
const spec = await open.json();
const defs = spec.definitions ?? {};
console.log(`\n=== ${envName.toUpperCase()} OpenAPI columns named staff_id ===`);
for (const [table, def] of Object.entries(defs)) {
  const props = def.properties ?? {};
  if (!props.staff_id) continue;
  const desc = props.staff_id.description ?? "";
  console.log(table, "staff_id:", desc.replace(/\s+/g, " ").slice(0, 200) || "(no desc)");
}
