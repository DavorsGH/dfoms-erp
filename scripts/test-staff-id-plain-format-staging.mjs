/**
 * Staging: plain staff_id on new employee create + spot-check EMP/SITE unchanged.
 * Mirrors allocateNewEmployeeCodes + toPlainStaffId (app create path).
 * Run: node scripts/test-staff-id-plain-format-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Same logic as employee-ids-api.toPlainStaffId */
function toPlainStaffId(code) {
  const trimmed = code.trim();
  const branded = /^([A-Z0-9]{2,5})-STAFF-(\d+)$/i.exec(trimmed);
  if (branded) {
    return `${branded[1].toUpperCase()}${branded[2]}`;
  }
  return trimmed;
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const apiSource = readFileSync(
  resolve("app/dashboard/employees/employee-ids-api.ts"),
  "utf8",
);
assert(apiSource.includes("toPlainStaffId"), "employee-ids-api missing toPlainStaffId");
assert(
  apiSource.includes("staffId: toPlainStaffId(staffResult.code)"),
  "allocateNewEmployeeCodes does not apply toPlainStaffId",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const tag = `STFPLAIN${Date.now().toString(36).toUpperCase()}`;

const { data: existingStaff, error: existingErr } = await supabase
  .from("employees")
  .select("staff_id")
  .eq("tenant_id", DAVORS);
if (existingErr) throw new Error(existingErr.message);

let maxPlain = 0;
for (const row of existingStaff ?? []) {
  const m = /^DF(\d+)$/.exec(String(row.staff_id));
  if (m) maxPlain = Math.max(maxPlain, Number(m[1]));
}

// id_sequences.next_value is last issued; keep it >= max existing plain staff_id.
const { data: seqRow, error: seqErr } = await supabase
  .from("id_sequences")
  .select("next_value")
  .eq("tenant_id", DAVORS)
  .eq("entity_type", "STAFF")
  .maybeSingle();
if (seqErr) throw new Error(seqErr.message);

const lastIssued = Math.max(seqRow?.next_value ?? 0, maxPlain);
if ((seqRow?.next_value ?? 0) < maxPlain) {
  const { error: bumpErr } = await supabase.from("id_sequences").upsert({
    tenant_id: DAVORS,
    entity_type: "STAFF",
    next_value: maxPlain,
  });
  if (bumpErr) throw new Error(`Failed to sync STAFF sequence: ${bumpErr.message}`);
  console.log("Synced STAFF next_value to", maxPlain, "(was", seqRow?.next_value, ")");
}

const expectedSeq = lastIssued + 1;
const expectedStaffId = `DF${String(expectedSeq).padStart(4, "0")}`;
console.log("Max existing plain staff:", maxPlain, "→ expect staff_id", expectedStaffId);

const { data: empRaw, error: empErr } = await supabase.rpc("generate_next_code", {
  p_tenant_id: DAVORS,
  p_entity_type: "EMP",
  p_padding: 4,
});
if (empErr || !empRaw) throw new Error(empErr?.message ?? "EMP allocate failed");

const { data: staffRaw, error: staffErr } = await supabase.rpc("generate_next_code", {
  p_tenant_id: DAVORS,
  p_entity_type: "STAFF",
  p_padding: 4,
});
if (staffErr || !staffRaw) throw new Error(staffErr?.message ?? "STAFF allocate failed");

const employeeId = String(empRaw).trim();
const staffId = toPlainStaffId(String(staffRaw).trim());
console.log("RPC EMP:", employeeId);
console.log("RPC STAFF raw:", staffRaw, "→ plain:", staffId);

assert(/^DF-EMP-\d{4}$/.test(employeeId), `EMP must stay branded, got ${employeeId}`);
assert(
  staffId === expectedStaffId,
  `Expected staff_id ${expectedStaffId}, got ${staffId} (raw ${staffRaw})`,
);
assert(!staffId.includes("STAFF"), "staff_id must not contain STAFF segment");
assert(/^DF\d{4}$/.test(staffId), `staff_id must be DF####, got ${staffId}`);

const { data: row, error: insertError } = await supabase
  .from("employees")
  .insert({
    tenant_id: DAVORS,
    employee_id: employeeId,
    staff_id: staffId,
    full_name: `${tag} Plain Staff Format`,
    employment_type: "Full-Time",
    employment_status: "Active",
    basic_salary: 0,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowances: 0,
  })
  .select("employee_id, staff_id")
  .single();
if (insertError || !row) throw new Error(insertError?.message ?? "insert failed");
console.log("PASS created employee:", row.employee_id, row.staff_id);

// Spot-check other entity types still branded
const { data: siteCode, error: siteErr } = await supabase.rpc("generate_next_code", {
  p_tenant_id: DAVORS,
  p_entity_type: "SITE",
  p_padding: 4,
});
if (siteErr || !siteCode) throw new Error(siteErr?.message ?? "SITE allocate failed");
assert(/^DF-SITE-\d{4}$/.test(String(siteCode)), `SITE must stay branded, got ${siteCode}`);
console.log("PASS SITE still branded:", siteCode);

const { data: expCode, error: expErr } = await supabase.rpc("generate_next_code", {
  p_tenant_id: DAVORS,
  p_entity_type: "EXP",
  p_padding: 4,
});
if (expErr || !expCode) throw new Error(expErr?.message ?? "EXP allocate failed");
assert(/^DF-EXP-\d{4}$/.test(String(expCode)), `EXP must stay branded, got ${expCode}`);
console.log("PASS EXP still branded:", expCode);

const { data: empAgain, error: empAgainErr } = await supabase.rpc("generate_next_code", {
  p_tenant_id: DAVORS,
  p_entity_type: "EMP",
  p_padding: 4,
});
if (empAgainErr || !empAgain) throw new Error(empAgainErr?.message ?? "EMP2 failed");
assert(/^DF-EMP-\d{4}$/.test(String(empAgain)), `EMP must stay branded, got ${empAgain}`);
console.log("PASS EMP still branded:", empAgain);

console.log("\nALL PASS — staff_id plain; EMP/SITE/EXP unchanged.");
console.log(
  "NOTE: if RPC STAFF raw was still DF-STAFF-####, DB migration 124 is not applied yet; app toPlainStaffId covers creates.",
);
