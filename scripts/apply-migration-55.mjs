import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in .env.local to apply migrations.");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const before = await client.query(`
      SELECT lt.type_name, lt.default_annual_entitlement,
             elb.employee_id, e.full_name, elb.year, elb.entitled_days, elb.days_used, elb.days_remaining
      FROM employee_leave_balances elb
      JOIN leave_types lt ON lt.id = elb.leave_type_id
      JOIN employees e ON e.employee_id = elb.employee_id
      WHERE lt.type_name = 'Annual Leave' AND elb.year = 2026
      ORDER BY e.full_name
      LIMIT 10
    `);

    console.log("=== BEFORE Annual Leave balances (sample) ===");
    console.log(JSON.stringify(before.rows, null, 2));

    const sql = readFileSync(
      resolve(process.cwd(), "scripts", "55_annual_leave_entitlement.sql"),
      "utf8",
    );

    console.log("\nApplying 55_annual_leave_entitlement.sql...");
    await client.query(sql);
    console.log("Applied.");

    const afterType = await client.query(`
      SELECT type_name, default_annual_entitlement
      FROM leave_types
      WHERE type_name = 'Annual Leave'
    `);

    const afterBalances = await client.query(`
      SELECT elb.employee_id, e.full_name, elb.entitled_days, elb.days_used, elb.days_remaining
      FROM employee_leave_balances elb
      JOIN leave_types lt ON lt.id = elb.leave_type_id
      JOIN employees e ON e.employee_id = elb.employee_id
      WHERE lt.type_name = 'Annual Leave' AND elb.year = 2026
      ORDER BY e.full_name
    `);

    const nonFifteen = afterBalances.rows.filter(
      (row) => Number(row.entitled_days) !== 15,
    );

    console.log("\n=== AFTER ===");
    console.log("leave_types:", JSON.stringify(afterType.rows[0], null, 2));
    console.log(
      "employee_leave_balances count:",
      afterBalances.rows.length,
      "non-15:",
      nonFifteen.length,
    );
    console.log(
      "Sample employees:",
      JSON.stringify(afterBalances.rows.slice(0, 4), null, 2),
    );

    const ok =
      Number(afterType.rows[0]?.default_annual_entitlement) === 15 &&
      nonFifteen.length === 0;

    console.log(`\nVerification: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
