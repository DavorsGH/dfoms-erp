import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = resolveDatabaseUrl();
  if (!url || !serviceKey || !databaseUrl) {
    throw new Error("Missing Supabase env or DATABASE_URL");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { default: pg } = await import("pg");
  const sql = new pg.Client({ connectionString: databaseUrl });
  await sql.connect();

  try {
    const cols = await sql.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'roster_history'
        AND column_name IN ('prepared_by', 'generated_by', 'date_generated')
      ORDER BY column_name
    `);

    // Prefer an employee who has roster_history rows
    const { data: withHistory } = await admin
      .from("roster_history")
      .select("employee_id, effective_date, roster_number, shift, new_location, generated_by")
      .order("effective_date", { ascending: false })
      .limit(5);

    const employeeId = withHistory?.[0]?.employee_id ?? null;

    let myRosterSim = null;
    if (employeeId) {
      const { data, error } = await admin
        .from("roster_history")
        .select("effective_date, roster_number, shift, new_location, generated_by")
        .eq("employee_id", employeeId)
        .order("effective_date", { ascending: false });

      myRosterSim = {
        employeeId,
        error: error?.message ?? null,
        rowCount: data?.length ?? 0,
        rows: data ?? [],
      };
    }

    // Confirm bogus prepared_by still fails
    const { error: preparedByError } = await admin
      .from("roster_history")
      .select("prepared_by")
      .limit(1);

    console.log(
      JSON.stringify(
        {
          columnsPresent: cols.rows.map((r) => r.column_name),
          hasPreparedBy: cols.rows.some((r) => r.column_name === "prepared_by"),
          hasGeneratedBy: cols.rows.some((r) => r.column_name === "generated_by"),
          preparedBySelectError: preparedByError?.message ?? null,
          myRosterQuery: myRosterSim,
        },
        null,
        2,
      ),
    );

    if (preparedByError == null) {
      throw new Error("Expected prepared_by select to fail, but it succeeded");
    }
    if (!myRosterSim || myRosterSim.error) {
      throw new Error(myRosterSim?.error ?? "No roster_history rows to verify My Roster query");
    }

    console.log("\nPASS: My Roster query works with generated_by");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
