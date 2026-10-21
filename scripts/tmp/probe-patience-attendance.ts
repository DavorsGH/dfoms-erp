import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  countAbsencesForStaff,
  type PayrollAttendanceSource,
} from "../../app/dashboard/hr-payroll/payroll-processing-utils";
import { resolveSelectedPeriod } from "../../app/dashboard/hr-payroll/payroll-period-utils";

function load(f: string) {
  for (const line of readFileSync(resolve(f), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
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

async function main() {
  load(".env.staging.local");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: a } = await admin
    .from("attendance_register")
    .select("staff_id, date, attendance_status, exception_status")
    .eq("staff_id", "DF0020")
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31")
    .order("date");
  const period = resolveSelectedPeriod(2026, 10);
  const count = countAbsencesForStaff(
    (a ?? []) as PayrollAttendanceSource[],
    "DF0020",
    2026,
    10,
  );
  console.log("period working days", period.totalWorkingDays);
  console.log("absence count", count);
  console.log(
    "rows",
    JSON.stringify(
      (a ?? []).filter(
        (r) =>
          r.exception_status === "absent" ||
          r.exception_status === "half_day" ||
          r.attendance_status === "Absent" ||
          r.attendance_status === "Half Day",
      ),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
