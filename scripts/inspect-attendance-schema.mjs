import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'attendance_register'
      ORDER BY ordinal_position
    `);
    console.log("attendance_register columns:", JSON.stringify(cols.rows, null, 2));

    const beatrice = await client.query(`
      SELECT ua.email, ua.employee_id, e.staff_id, e.full_name
      FROM user_accounts ua
      JOIN employees e ON e.employee_id = ua.employee_id
      WHERE ua.email ILIKE '%beatrice%' OR e.full_name ILIKE '%beatrice%martey%'
      LIMIT 5
    `);
    console.log("Beatrice account:", JSON.stringify(beatrice.rows, null, 2));

    if (beatrice.rows[0]?.staff_id) {
      const attendance = await client.query(
        `
        SELECT *
        FROM attendance_register
        WHERE staff_id = $1
          AND date >= '2026-07-01' AND date <= '2026-07-31'
        ORDER BY date
      `,
        [beatrice.rows[0].staff_id],
      );
      console.log(
        "Beatrice July 2026 attendance:",
        JSON.stringify(attendance.rows, null, 2),
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
