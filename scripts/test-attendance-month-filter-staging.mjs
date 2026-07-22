/**
 * Staging: verify attendance month-range queries + CRUD with a selected month.
 * Mirrors the date-range filter used by Attendance Register.
 *
 * Usage: node scripts/test-attendance-month-filter-staging.mjs
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

function monthBounds(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const pageSource = readFileSync(
  resolve("app/dashboard/hr-payroll/attendance/page.tsx"),
  "utf8",
);
const uiSource = readFileSync(
  resolve("app/dashboard/hr-payroll/attendance-register.tsx"),
  "utf8",
);
assert(pageSource.includes(".gte(\"date\", start)"), "page missing date gte");
assert(pageSource.includes(".lte(\"date\", end)"), "page missing date lte");
assert(uiSource.includes("handleMonthChange"), "UI missing month handler");
assert(uiSource.includes("handleYearChange"), "UI missing year handler");
assert(
  uiSource.includes("defaultAttendanceDateForMonth"),
  "UI missing default date helper",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function countForMonth(year, month) {
  const { start, end } = monthBounds(year, month);
  const { data, error } = await supabase
    .from("attendance_register")
    .select("id, date")
    .eq("tenant_id", DAVORS)
    .gte("date", start)
    .lte("date", end);
  if (error) throw new Error(error.message);
  return { start, end, rows: data ?? [] };
}

const june = await countForMonth(2026, 6);
const july = await countForMonth(2026, 7);
const may = await countForMonth(2026, 5);

console.log("June 2026:", june.rows.length, `(${june.start}..${june.end})`);
console.log("July 2026:", july.rows.length, `(${july.start}..${july.end})`);
console.log("May 2026:", may.rows.length, `(${may.start}..${may.end})`);

assert(june.rows.length > 0, "Expected June rows");
assert(july.rows.length > 0, "Expected July rows");
assert(may.rows.length === 0, "Expected May empty");
assert(
  june.rows.every((r) => r.date.slice(0, 7) === "2026-06"),
  "June query leaked other months",
);
assert(
  july.rows.every((r) => r.date.slice(0, 7) === "2026-07"),
  "July query leaked other months",
);

const { data: staffRow, error: staffError } = await supabase
  .from("employees")
  .select("staff_id")
  .eq("tenant_id", DAVORS)
  .not("staff_id", "is", null)
  .limit(1)
  .maybeSingle();
if (staffError || !staffRow?.staff_id) {
  throw new Error(staffError?.message ?? "No staff for CRUD test");
}

const tag = `ATTN-FILTER-${Date.now().toString(36).toUpperCase()}`;
const testDate = "2026-06-18";

const { data: inserted, error: insertError } = await supabase
  .from("attendance_register")
  .insert({
    tenant_id: DAVORS,
    date: testDate,
    staff_id: staffRow.staff_id,
    employment_type: "Full-Time",
    project_assignment: tag,
    clock_in: "08:00",
    clock_out: "17:00",
    hours_worked: 9,
    overtime_hours: 0,
    attendance_status: "Present",
  })
  .select("id, date, project_assignment, attendance_status")
  .single();

if (insertError) throw new Error(insertError.message);
console.log("Inserted:", inserted);

const juneAfterInsert = await countForMonth(2026, 6);
assert(
  juneAfterInsert.rows.some((r) => r.id === inserted.id),
  "Inserted June row missing from June range",
);
const julyAfterInsert = await countForMonth(2026, 7);
assert(
  !julyAfterInsert.rows.some((r) => r.id === inserted.id),
  "June insert incorrectly appears in July range",
);

const { data: updated, error: updateError } = await supabase
  .from("attendance_register")
  .update({ attendance_status: "Absent", project_assignment: `${tag}-EDIT` })
  .eq("id", inserted.id)
  .select("id, attendance_status, project_assignment")
  .single();
if (updateError) throw new Error(updateError.message);
assert(updated.attendance_status === "Absent", "Edit status failed");
console.log("Updated:", updated);

const { error: deleteError } = await supabase
  .from("attendance_register")
  .delete()
  .eq("id", inserted.id);
if (deleteError) throw new Error(deleteError.message);

const juneAfterDelete = await countForMonth(2026, 6);
assert(
  !juneAfterDelete.rows.some((r) => r.id === inserted.id),
  "Deleted row still in June range",
);

console.log("SUCCESS: month filter + CRUD verified");
