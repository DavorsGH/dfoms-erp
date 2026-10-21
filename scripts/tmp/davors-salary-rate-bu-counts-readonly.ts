// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(resolve(filePath), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnvForce(".env.local.production-backup-2026-08-25");
  const DAVORS = "00000001-0000-4000-8000-000000000001";
  const client = new pg.Client({
    connectionString: resolveDatabaseUrl()!,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const counts = await client.query(
    `SELECT coalesce(business_unit_id::text, '__NULL__') AS bu_key, count(*)::int AS c
     FROM public.salary_rate_config
     WHERE tenant_id = $1
     GROUP BY 1
     ORDER BY c DESC, bu_key`,
    [DAVORS],
  );
  const units = await client.query(
    `SELECT id::text, name FROM public.business_units WHERE tenant_id = $1 ORDER BY name`,
    [DAVORS],
  );
  console.log("Davors salary_rate_config row counts by business_unit_id:");
  for (const row of counts.rows) {
    console.log(`  ${row.bu_key}: ${row.c}`);
  }
  console.log("\nDavors business_units:");
  for (const row of units.rows) {
    console.log(`  ${row.id}  ${row.name}`);
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
