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
    const before = await client.query(`
      SELECT roster_number, generated_by, employee_id
      FROM roster_history
      WHERE generated_by ILIKE '%RBAC%'
         OR roster_number IN ('R9001', 'R9002', 'R9003', 'R9098', 'R9099')
      ORDER BY roster_number
    `);

    console.log("Test rows to delete:", before.rows);

    await client.query(
      "ALTER TABLE roster_history DISABLE TRIGGER trg_protect_roster_history",
    );

    let deleted;
    try {
      deleted = await client.query(`
        DELETE FROM roster_history
        WHERE generated_by ILIKE '%RBAC%'
           OR roster_number IN ('R9001', 'R9002', 'R9003', 'R9098', 'R9099')
        RETURNING roster_number, generated_by
      `);
    } finally {
      await client.query(
        "ALTER TABLE roster_history ENABLE TRIGGER trg_protect_roster_history",
      );
    }

    const remaining = await client.query(
      `SELECT COUNT(*)::int AS count FROM roster_history`,
    );

    // Confirm append-only trigger still blocks delete
    let triggerBlocked = false;
    try {
      await client.query(`
        INSERT INTO roster_history (
          roster_number, rotation_number, effective_date, employee_id,
          previous_location, new_location, position, shift, generated_by, date_generated
        ) VALUES (
          'R99TEMP', 1, CURRENT_DATE, 'EMP0001',
          'PRJ01', 'PRJ01', 'Test', 'Morning', 'cleanup-probe', CURRENT_DATE
        )
      `);
      await client.query(
        `DELETE FROM roster_history WHERE roster_number = 'R99TEMP'`,
      );
    } catch (error) {
      triggerBlocked = String(error.message).includes("append-only");
    }

    // Clean up probe insert if it landed
    await client.query(
      "ALTER TABLE roster_history DISABLE TRIGGER trg_protect_roster_history",
    );
    await client.query(
      `DELETE FROM roster_history WHERE roster_number = 'R99TEMP'`,
    );
    await client.query(
      "ALTER TABLE roster_history ENABLE TRIGGER trg_protect_roster_history",
    );

    console.log(
      JSON.stringify(
        {
          deletedCount: deleted.rowCount,
          deleted: deleted.rows,
          remainingTotal: remaining.rows[0].count,
          appendOnlyTriggerActive: triggerBlocked,
        },
        null,
        2,
      ),
    );

    if (remaining.rows[0].count !== 0) {
      throw new Error("roster_history still has rows after cleanup");
    }
    if (!triggerBlocked) {
      throw new Error("Append-only trigger did not block delete probe");
    }

    console.log(
      "\nPASS: RBAC seed removed; roster_history empty; append-only trigger restored.",
    );
  } finally {
    await client
      .query("ALTER TABLE roster_history ENABLE TRIGGER trg_protect_roster_history")
      .catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
