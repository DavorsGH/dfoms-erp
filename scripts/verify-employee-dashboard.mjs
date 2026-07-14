import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function currentMonthBounds() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return {
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
    year,
  };
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) throw new Error("Missing Supabase env vars");

  const { default: pg } = await import("pg");
  const { resolveDatabaseUrl, loadEnvFile: loadDbEnv } = await import(
    "./resolve-database-url.mjs"
  );
  loadDbEnv(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const sql = new pg.Client({ connectionString: databaseUrl });
  await sql.connect();

  const cols = await sql.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_register'
    ORDER BY ordinal_position
  `);
  const columnNames = cols.rows.map((row) => row.column_name);
  console.log("attendance_register columns:", columnNames.join(", "));
  console.log(
    "has attendance_status:",
    columnNames.includes("attendance_status"),
  );
  console.log("has status:", columnNames.includes("status"));

  const beatrice = await sql.query(`
    SELECT ua.email, ua.employee_id, e.staff_id, e.full_name
    FROM user_accounts ua
    JOIN employees e ON e.employee_id = ua.employee_id
    WHERE ua.email ILIKE '%avorsjason%' OR e.full_name ILIKE '%beatrice%martey%'
    LIMIT 1
  `);

  const beatriceRow = beatrice.rows[0];
  if (!beatriceRow) {
    throw new Error("Beatrice account not found");
  }

  console.log("Beatrice:", beatriceRow);

  const { startIso, endIso, year } = currentMonthBounds();
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let password = process.env.BEATRICE_TEST_PASSWORD ?? "TestRbac1!";
  let { error: signInError } = await client.auth.signInWithPassword({
    email: beatriceRow.email,
    password,
  });

  if (signInError && serviceKey) {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authUser } = await admin.auth.admin.listUsers();
    const user = authUser.users.find((entry) => entry.email === beatriceRow.email);
    if (user) {
      await admin.auth.admin.updateUserById(user.id, {
        password: "TestRbac1!",
      });
      password = "TestRbac1!";
      ({ error: signInError } = await client.auth.signInWithPassword({
        email: beatriceRow.email,
        password,
      }));
    }
  }

  if (signInError) {
    throw new Error(`Beatrice sign-in failed: ${signInError.message}`);
  }

  const [
    { data: attendance, error: attendanceError },
    { data: balances, error: balancesError },
    { data: leaveRequests, error: leaveError },
    { data: payrollHistory, error: payrollError },
  ] = await Promise.all([
    client
      .from("attendance_register")
      .select("date, attendance_status")
      .eq("staff_id", beatriceRow.staff_id)
      .gte("date", startIso)
      .lte("date", endIso),
    client
      .from("employee_leave_balances")
      .select("days_remaining, leave_types(type_name)")
      .eq("employee_id", beatriceRow.employee_id)
      .eq("year", year),
    client
      .from("leave_requests")
      .select("status")
      .eq("employee_id", beatriceRow.employee_id),
    client
      .from("payroll_history")
      .select("payroll_month")
      .eq("employee_id", beatriceRow.employee_id)
      .order("payroll_month", { ascending: false })
      .limit(1),
  ]);

  const errors = {
    attendance: attendanceError?.message ?? null,
    balances: balancesError?.message ?? null,
    leave: leaveError?.message ?? null,
    payroll: payrollError?.message ?? null,
  };

  const attendanceRows = attendance ?? [];
  const presentDays = attendanceRows.filter((row) => {
    const status = (row.attendance_status ?? "").trim().toLowerCase();
    return status === "present";
  }).length;

  const result = {
    email: beatriceRow.email,
    employeeId: beatriceRow.employee_id,
    staffId: beatriceRow.staff_id,
    monthRange: { startIso, endIso },
    attendanceRecorded: attendanceRows.length,
    presentDays,
    errors,
    fetchError:
      errors.attendance ?? errors.balances ?? errors.leave ?? errors.payroll,
    ok: !(
      errors.attendance ||
      errors.balances ||
      errors.leave ||
      errors.payroll
    ),
  };

  console.log(JSON.stringify(result, null, 2));
  await sql.end();

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
