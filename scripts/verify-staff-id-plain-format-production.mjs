/**
 * Production read-only checks for staff_id plain format readiness.
 * Does NOT create employees or allocate sequences.
 * Run: node scripts/verify-staff-id-plain-format-production.mjs
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

loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing production env (.env.local.backup)");
assert(supabaseUrl.includes("tvcurcnmasnocwdxzgvz"), "Refusing non-production");

const apiSource = readFileSync(
  resolve("app/dashboard/employees/employee-ids-api.ts"),
  "utf8",
);
assert(
  apiSource.includes("staffId: toPlainStaffId(staffResult.code)"),
  "App create path missing toPlainStaffId",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: employees, error: empErr } = await supabase
  .from("employees")
  .select("staff_id, employee_id, full_name")
  .eq("tenant_id", DAVORS)
  .order("staff_id");
if (empErr) throw new Error(empErr.message);

const brandedStaff = (employees ?? []).filter((e) =>
  String(e.staff_id).includes("STAFF"),
);
const plainStaff = (employees ?? []).filter((e) =>
  /^DF\d{4}$/.test(String(e.staff_id)),
);
const brandedEmp = (employees ?? []).filter((e) =>
  /^DF-EMP-\d{4}$/.test(String(e.employee_id)),
);
const legacyEmp = (employees ?? []).filter(
  (e) => !/^DF-EMP-\d{4}$/.test(String(e.employee_id)),
);

console.log("Production Davors employees:", employees?.length ?? 0);
console.log("  plain staff_id DF####:", plainStaff.length);
console.log("  branded *-STAFF-* staff_id:", brandedStaff.length);
console.log("  branded DF-EMP-#### employee_id:", brandedEmp.length);
console.log("  other/legacy employee_id:", legacyEmp.length);
if (brandedStaff.length) {
  console.log(
    "  branded samples:",
    brandedStaff.slice(0, 5).map((e) => e.staff_id),
  );
}

const { data: seq, error: seqErr } = await supabase
  .from("id_sequences")
  .select("entity_type, next_value")
  .eq("tenant_id", DAVORS)
  .in("entity_type", ["STAFF", "EMP", "SITE", "EXP"]);
if (seqErr) throw new Error(seqErr.message);
console.log("id_sequences:", seq);

const staffLast = seq?.find((r) => r.entity_type === "STAFF")?.next_value;
const nextStaff =
  staffLast != null ? staffLast + 1 : 1;
console.log(
  "Next create (via app) would get staff_id:",
  `DF${String(nextStaff).padStart(4, "0")}`,
);

assert(brandedStaff.length === 0, "Production still has branded STAFF staff_ids");
assert(plainStaff.length === (employees?.length ?? 0), "Not all staff_ids are plain DF####");
assert(brandedEmp.length >= 1, "Expected at least one DF-EMP-#### employee_id");

console.log("\nPASS production read-only: existing staff_ids plain; EMP branded format present.");
console.log(
  "App toPlainStaffId is in place for new creates (works even if RPC still returns DF-STAFF-####).",
);
console.log(
  "DB migration 124 still needed for RPC itself to return plain STAFF codes (staging/prod DB password auth currently failing).",
);
