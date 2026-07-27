/**
 * Staging: employees.supervisor must be employee_id (composite FK), not a name.
 * Mirrors Employee Directory save: value=employee_id, empty → null.
 *
 * Run: node scripts/test-employee-supervisor-fk-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    process.env[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const dirSource = readFileSync(
  resolve("app/dashboard/employees/employees-directory.tsx"),
  "utf8",
);
assert(
  dirSource.includes('Field label="Supervisor"') &&
    dirSource.includes("<select") &&
    dirSource.includes("supervisorOptions") &&
    dirSource.includes("editingEmployeeId") &&
    dirSource.includes("isActiveEmployee") &&
    dirSource.includes("Select supervisor"),
  "employees-directory.tsx missing supervisor <select> pattern",
);
assert(
  !/<Field label="Supervisor">\s*<input\s+type="text"/.test(dirSource),
  "Supervisor field still a text input",
);
console.log("PASS UI source: Supervisor is select with active + self-exclude");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const tag = `SUPV${Date.now().toString(36).toUpperCase()}`;

const { data: roster, error: rosterErr } = await supabase
  .from("employees")
  .select(
    "employee_id, staff_id, full_name, supervisor, employment_status, tenant_id",
  )
  .eq("tenant_id", DAVORS)
  .order("staff_id");
if (rosterErr) throw new Error(rosterErr.message);

const df0002 = roster.find((row) => row.staff_id === "DF0002");
assert(df0002, "DF0002 not found on Davors staging");

const activeOthers = roster.filter(
  (row) =>
    row.employee_id !== df0002.employee_id &&
    (!row.employment_status ||
      row.employment_status.trim().toLowerCase() === "active"),
);
assert(activeOthers.length >= 1, "Need at least one other active employee");

const supervisor = activeOthers[0];
console.log(
  "Using supervisor:",
  supervisor.staff_id,
  supervisor.employee_id,
  "for new hire under DF0002 context",
);

// 1) Insert with supervisor = employee_id (what the new select submits)
const { data: empCode, error: empErr } = await supabase.rpc(
  "generate_next_code",
  { p_tenant_id: DAVORS, p_entity_type: "EMP", p_padding: 4 },
);
if (empErr || !empCode) throw new Error(empErr?.message ?? "EMP allocate failed");

const { data: staffCode, error: staffErr } = await supabase.rpc(
  "generate_next_code",
  { p_tenant_id: DAVORS, p_entity_type: "STAFF", p_padding: 4 },
);
if (staffErr || !staffCode) {
  throw new Error(staffErr?.message ?? "STAFF allocate failed");
}

const insertPayload = {
  tenant_id: DAVORS,
  employee_id: empCode,
  staff_id: staffCode,
  full_name: `Supervisor FK Test ${tag}`,
  employment_type: "Permanent",
  employment_status: "Active",
  supervisor: supervisor.employee_id,
};
const { data: inserted, error: insertErr } = await supabase
  .from("employees")
  .insert(insertPayload)
  .select("employee_id, staff_id, supervisor")
  .single();

assert(!insertErr, `Insert with supervisor employee_id failed: ${insertErr?.message}`);
assert(
  inserted.supervisor === supervisor.employee_id,
  "Inserted supervisor mismatch",
);
console.log(
  "PASS insert with supervisor employee_id:",
  inserted.employee_id,
  "→",
  inserted.supervisor,
);

// Negative: raw name (old text-input bug) must still fail FK
const { error: badInsertErr } = await supabase.from("employees").insert({
  tenant_id: DAVORS,
  employee_id: `${empCode}-BAD`,
  staff_id: `${staffCode}-BAD`,
  full_name: `Bad Supervisor Name ${tag}`,
  employment_type: "Permanent",
  employment_status: "Active",
  supervisor: supervisor.full_name,
});
assert(
  badInsertErr && /employees_supervisor_fkey|foreign key/i.test(badInsertErr.message),
  `Expected FK error for name supervisor, got: ${badInsertErr?.message ?? "success"}`,
);
console.log("PASS name-as-supervisor still rejected by FK");

// 2) Edit DF0002: set supervisor then clear to null (empty select)
const priorSupervisor = df0002.supervisor;
const otherForDf = activeOthers.find(
  (row) => row.employee_id !== inserted.employee_id,
) ?? supervisor;

const { error: setErr } = await supabase
  .from("employees")
  .update({ supervisor: otherForDf.employee_id })
  .eq("tenant_id", DAVORS)
  .eq("employee_id", df0002.employee_id);
assert(!setErr, `DF0002 set supervisor failed: ${setErr?.message}`);

const { data: afterSet, error: afterSetErr } = await supabase
  .from("employees")
  .select("employee_id, staff_id, supervisor")
  .eq("tenant_id", DAVORS)
  .eq("employee_id", df0002.employee_id)
  .single();
assert(!afterSetErr, afterSetErr?.message);
assert(
  afterSet.supervisor === otherForDf.employee_id,
  "DF0002 supervisor not set",
);
console.log(
  "PASS DF0002 supervisor set to",
  otherForDf.staff_id,
  otherForDf.employee_id,
);

const { error: clearErr } = await supabase
  .from("employees")
  .update({ supervisor: null })
  .eq("tenant_id", DAVORS)
  .eq("employee_id", df0002.employee_id);
assert(!clearErr, `DF0002 clear supervisor failed: ${clearErr?.message}`);

const { data: afterClear, error: afterClearErr } = await supabase
  .from("employees")
  .select("employee_id, staff_id, supervisor")
  .eq("tenant_id", DAVORS)
  .eq("employee_id", df0002.employee_id)
  .single();
assert(!afterClearErr, afterClearErr?.message);
assert(
  afterClear.supervisor === null,
  `Expected null supervisor, got ${JSON.stringify(afterClear.supervisor)}`,
);
console.log("PASS DF0002 empty supervisor stores null");

// Self-exclude simulation (UI): DF0002 must not appear in own options
const optionsForDf0002 = roster.filter(
  (row) =>
    row.employee_id !== df0002.employee_id &&
    (!row.employment_status ||
      row.employment_status.trim().toLowerCase() === "active"),
);
assert(
  !optionsForDf0002.some((row) => row.employee_id === df0002.employee_id),
  "Self still in options",
);
console.log(
  "PASS self-exclude logic: DF0002 options count",
  optionsForDf0002.length,
  "(excludes self)",
);

// Cleanup: delete test employee; restore DF0002 prior supervisor
const { error: delErr } = await supabase
  .from("employees")
  .delete()
  .eq("tenant_id", DAVORS)
  .eq("employee_id", inserted.employee_id);
assert(!delErr, `Cleanup delete failed: ${delErr?.message}`);

const { error: restoreErr } = await supabase
  .from("employees")
  .update({ supervisor: priorSupervisor })
  .eq("tenant_id", DAVORS)
  .eq("employee_id", df0002.employee_id);
assert(!restoreErr, `Restore DF0002 failed: ${restoreErr?.message}`);
console.log("Cleanup done; DF0002 supervisor restored to", priorSupervisor);

console.log("\nAll supervisor FK staging checks passed.");
