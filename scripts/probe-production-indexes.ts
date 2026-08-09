import { resolve } from "node:path";
import { loadEnvForce } from "./lib/env";
import { connectPg } from "./lib/pg-connect";

const tables = [
  "employees",
  "income_register",
  "expense_register",
  "payroll_history",
  "payroll_processing",
  "attendance_register",
  "user_accounts",
];

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const { client, envFile, candidateIndex } = await connectPg({
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  for (const table of tables) {
    const result = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`,
      [table],
    );
    console.log(`\n=== ${table} (${result.rowCount} indexes) ===`);
    for (const row of result.rows) {
      console.log(`${row.indexname}: ${row.indexdef}`);
    }
  }

  const counts = await client.query(`
    SELECT relname AS table_name, n_live_tup::bigint AS est_rows
    FROM pg_stat_user_tables
    WHERE relname = ANY($1::text[])
    ORDER BY relname
  `, [tables]);

  console.log("\n=== Estimated row counts (pg_stat) ===");
  for (const row of counts.rows) {
    console.log(`${row.table_name}: ${row.est_rows}`);
  }

  const explain = await client.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT *
    FROM expense_register
    WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
    ORDER BY date DESC
  `);
  console.log("\n=== EXPLAIN expense_register (tenant + date order) ===");
  for (const row of explain.rows) {
    console.log(row["QUERY PLAN"]);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
