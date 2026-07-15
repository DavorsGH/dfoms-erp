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
    const triggers = await client.query(`
      SELECT t.tgname, p.proname, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE c.relname = 'roster_history' AND NOT t.tgisinternal
    `);

    const fnBodies = await client.query(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      WHERE p.proname ILIKE '%roster%'
      ORDER BY p.proname
    `);

    console.log(JSON.stringify({ triggers: triggers.rows, rosterFns: fnBodies.rows.map((r) => r.proname) }, null, 2));

    for (const row of fnBodies.rows) {
      if (row.def.includes("append-only") || row.def.includes("never be edited")) {
        console.log("\n--- MATCHED FUNCTION ---\n", row.proname);
        console.log(row.def);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
