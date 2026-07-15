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
    const testRows = await client.query(`
      SELECT roster_number, rotation_number, effective_date, end_date,
             employee_id, previous_location, new_location, position, shift,
             generated_by, date_generated
      FROM roster_history
      WHERE generated_by ILIKE '%RBAC%'
         OR roster_number IN ('R9001', 'R9002', 'R9003', 'R9098', 'R9099')
      ORDER BY roster_number
    `);

    // Check FKs referencing roster_history
    const fks = await client.query(`
      SELECT
        tc.table_name AS referencing_table,
        kcu.column_name AS referencing_column,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'roster_history'
    `);

    // Also check any column named like roster_number elsewhere that might soft-reference
    const softRefs = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name IN ('roster_number', 'roster_history_id')
        AND table_name <> 'roster_history'
      ORDER BY table_name, column_name
    `);

    const allCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM roster_history`,
    );

    console.log(
      JSON.stringify(
        {
          totalRosterHistoryRows: allCount.rows[0].count,
          testRowsToDelete: testRows.rows,
          testRowCount: testRows.rows.length,
          foreignKeysReferencingRosterHistory: fks.rows,
          softReferenceColumns: softRefs.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
