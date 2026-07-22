/**
 * Staging: EMP + STAFF generate_next_code for new employees (both tenants).
 * Run: node scripts/test-employee-ids-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

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
  dirSource.includes("allocateNewEmployeeCodes"),
  "directory does not call allocateNewEmployeeCodes",
);
assert(
  !dirSource.includes("generateNextEmployeeId("),
  "directory still calls generateNextEmployeeId",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const tag = `EMPID${Date.now().toString(36).toUpperCase()}`;

async function snapshotEmployees(tenantId) {
  const { data, error } = await supabase
    .from("employees")
    .select("employee_id, staff_id, full_name, employment_type")
    .eq("tenant_id", tenantId)
    .order("employee_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row }));
}

async function createEmployee(tenantId, expectedEmpPrefix, expectedStaffPrefix) {
  const { data: empCode, error: empErr } = await supabase.rpc(
    "generate_next_code",
    { p_tenant_id: tenantId, p_entity_type: "EMP", p_padding: 4 },
  );
  if (empErr || !empCode) throw new Error(empErr?.message ?? "EMP allocate failed");

  const { data: staffCode, error: staffErr } = await supabase.rpc(
    "generate_next_code",
    { p_tenant_id: tenantId, p_entity_type: "STAFF", p_padding: 4 },
  );
  if (staffErr || !staffCode) {
    throw new Error(staffErr?.message ?? "STAFF allocate failed");
  }

  assert(
    new RegExp(`^${expectedEmpPrefix}\\d{4}$`).test(empCode),
    `Expected ${expectedEmpPrefix}####, got ${empCode}`,
  );
  assert(
    new RegExp(`^${expectedStaffPrefix}\\d{4}$`).test(staffCode),
    `Expected ${expectedStaffPrefix}####, got ${staffCode}`,
  );

  const payload = {
    tenant_id: tenantId,
    employee_id: empCode,
    staff_id: staffCode,
    full_name: `${tag} Test Employee`,
    employment_type: "Full-Time",
    employment_status: "Active",
    basic_salary: 0,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowances: 0,
  };

  const { data: row, error: insertError } = await supabase
    .from("employees")
    .insert(payload)
    .select("employee_id, staff_id, tenant_id, employment_type")
    .single();

  if (insertError || !row) {
    throw new Error(insertError?.message ?? "employee insert failed");
  }

  assert(row.employment_type === "Full-Time", "employment_type not persisted");
  return row;
}

const beforeDavors = await snapshotEmployees(DAVORS);
const beforeCaanta = await snapshotEmployees(CAANTA);
console.log("Prior employees — Davors:", beforeDavors.length, "Caanta:", beforeCaanta.length);

const davors = await createEmployee(DAVORS, "DF-EMP-", "DF-STAFF-");
console.log("PASS Davors created:", davors.employee_id, davors.staff_id);

const caanta = await createEmployee(CAANTA, "CAN-EMP-", "CAN-STAFF-");
console.log("PASS Caanta created:", caanta.employee_id, caanta.staff_id);

assert(
  !davors.staff_id.startsWith("DF0") && davors.staff_id.includes("STAFF"),
  "Davors staff_id should be branded STAFF format, not legacy DF####",
);
assert(
  caanta.staff_id.startsWith("CAN-STAFF-"),
  "Caanta must not get DF staff_id prefix",
);

// Prior rows unchanged
for (const [label, tenantId, before] of [
  ["Davors", DAVORS, beforeDavors],
  ["Caanta", CAANTA, beforeCaanta],
]) {
  const after = await snapshotEmployees(tenantId);
  for (const prior of before) {
    const match = after.find((row) => row.employee_id === prior.employee_id);
    assert(match, `${label} missing prior ${prior.employee_id}`);
    assert(
      match.staff_id === prior.staff_id,
      `${label} staff_id changed for ${prior.employee_id}`,
    );
    assert(
      match.full_name === prior.full_name,
      `${label} full_name changed for ${prior.employee_id}`,
    );
  }
  console.log(`PASS ${label} prior employees unchanged (${before.length})`);
}

// FK spot reads — existing relationships still resolve
const spotChecks = [];

const { data: approvers, error: approversError } = await supabase
  .from("approvers")
  .select("employee_id, employees!approvers_employee_id_fkey(employee_id, full_name)")
  .limit(3);
if (approversError) throw new Error(`approvers spot: ${approversError.message}`);
spotChecks.push({ table: "approvers", rows: approvers?.length ?? 0 });

const { data: workOrders, error: woError } = await supabase
  .from("work_orders")
  .select(
    "work_order_no, assigned_cleaner, supervisor, cleaner:employees!work_orders_assigned_cleaner_fkey(employee_id, full_name)",
  )
  .not("assigned_cleaner", "is", null)
  .limit(3);
if (woError) throw new Error(`work_orders spot: ${woError.message}`);
spotChecks.push({ table: "work_orders", rows: workOrders?.length ?? 0 });

const { data: accounts, error: uaError } = await supabase
  .from("user_accounts")
  .select(
    "auth_uid, employee_id, employees!user_accounts_employee_id_fkey(employee_id, full_name)",
  )
  .not("employee_id", "is", null)
  .limit(3);
if (uaError) throw new Error(`user_accounts spot: ${uaError.message}`);
spotChecks.push({ table: "user_accounts", rows: accounts?.length ?? 0 });

console.log("PASS FK spot reads:", spotChecks);

// Cleanup test employees (no FKs expected)
for (const row of [davors, caanta]) {
  const { error: delError } = await supabase
    .from("employees")
    .delete()
    .eq("tenant_id", row.tenant_id)
    .eq("employee_id", row.employee_id);
  if (delError) console.warn("cleanup warning:", row.employee_id, delError.message);
  else console.log("cleaned", row.employee_id);
}

console.log("\nALL PASS", {
  davors: { employee_id: davors.employee_id, staff_id: davors.staff_id },
  caanta: { employee_id: caanta.employee_id, staff_id: caanta.staff_id },
});
