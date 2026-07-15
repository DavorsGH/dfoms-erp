import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

function extractMs(explainText) {
  const match = explainText.match(/Execution Time:\s*([0-9.]+)\s*ms/i);
  return match ? Number(match[1]) : null;
}

async function explainQuery(client, label, sql, params = []) {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, params);
  const plan = result.rows.map((row) => row["QUERY PLAN"]).join("\n");
  return {
    label,
    executionMs: extractMs(plan),
    plan,
  };
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const sites = await client.query(`
      SELECT site_code
      FROM user_account_supervisor_sites
      GROUP BY site_code
      ORDER BY COUNT(*) DESC, site_code
      LIMIT 2
    `);

    let siteCodes = sites.rows.map((r) => r.site_code);
    if (siteCodes.length === 0) {
      const fallback = await client.query(`
        SELECT assigned_site_id AS site_code
        FROM employees
        WHERE assigned_site_id IS NOT NULL
        GROUP BY assigned_site_id
        ORDER BY COUNT(*) DESC
        LIMIT 2
      `);
      siteCodes = fallback.rows.map((r) => r.site_code);
    }

    if (siteCodes.length === 0) {
      throw new Error("No site codes available for supervisor-scoped timing test");
    }

    const representativeSql = `
      SELECT e.employee_id, e.full_name, e.assigned_site_id, e.shift, e.contract_project
      FROM employees e
      WHERE e.assigned_site_id = ANY($1::text[])
      ORDER BY e.full_name
    `;

    console.log("Representative query sites:", siteCodes);

    const before = await explainQuery(
      client,
      "BEFORE indexes",
      representativeSql,
      [siteCodes],
    );
    console.log("\n=== BEFORE ===");
    console.log(before.plan);
    console.log("Execution Time (ms):", before.executionMs);

    const sql = readFileSync(
      resolve(process.cwd(), "scripts/58_rls_filter_indexes.sql"),
      "utf8",
    );
    console.log("\nApplying 58_rls_filter_indexes.sql...");
    await client.query(sql);
    console.log("Applied.");

    // Warm then measure
    await client.query(representativeSql, [siteCodes]);
    const after = await explainQuery(
      client,
      "AFTER indexes",
      representativeSql,
      [siteCodes],
    );
    console.log("\n=== AFTER ===");
    console.log(after.plan);
    console.log("Execution Time (ms):", after.executionMs);

    const created = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE 'idx_%'
        AND (
          indexname LIKE 'idx_employees_assigned_site%'
          OR indexname LIKE 'idx_roster_history_employee%'
          OR indexname LIKE 'idx_sites_client%'
          OR indexname LIKE 'idx_work_orders_site%'
          OR indexname LIKE 'idx_internal_consumption_%'
          OR indexname LIKE 'idx_income_register_%'
        )
      ORDER BY tablename, indexname
    `);

    const sampleMissingCheck = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'idx_employees_assigned_site_id') AS employees_site_idx,
        (SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'idx_roster_history_employee_id') AS roster_employee_idx,
        (SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'idx_internal_consumption_product_id') AS ic_product_idx
    `);

    console.log(
      "\n" +
        JSON.stringify(
          {
            sitesUsed: siteCodes,
            beforeMs: before.executionMs,
            afterMs: after.executionMs,
            deltaMs:
              before.executionMs != null && after.executionMs != null
                ? Number((before.executionMs - after.executionMs).toFixed(3))
                : null,
            sampleIndexesPresent: sampleMissingCheck.rows[0],
            sampleCreatedIndexes: created.rows,
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
