/**
 * Read-only production: run Release 1 audit SQL files and summarise by tenant.
 * npx tsx scripts/audits/run-release1-production-audits.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const OUT = resolve(process.cwd(), "scripts/audits/output");

const AUDITS = [
  {
    name: "stock_adjustments_missing_balancing",
    file: "scripts/audits/stock_adjustments_missing_balancing.sql",
  },
  {
    name: "negative_wac_and_inventory_mismatch",
    file: "scripts/audits/negative_wac_and_inventory_mismatch.sql",
  },
  {
    name: "audit_zero_cogs_product_sales",
    file: "scripts/audits/audit_zero_cogs_product_sales.sql",
  },
] as const;

function summarizeByTenant(
  rows: Array<Record<string, unknown>>,
  tenantKey = "tenant_name",
) {
  const byTenant = new Map<string, number>();
  for (const row of rows) {
    const name = String(row[tenantKey] ?? row.tenant_id ?? "unknown");
    byTenant.set(name, (byTenant.get(name) ?? 0) + 1);
  }
  return Object.fromEntries([...byTenant.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

async function runSqlFile(
  client: Awaited<ReturnType<typeof connectPg>>["client"],
  path: string,
) {
  const sql = readFileSync(resolve(process.cwd(), path), "utf8");
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  const resultSets: Array<{ rows: Record<string, unknown>[] }> = [];
  for (const stmt of statements) {
    const res = await client.query(stmt);
    if (res.rows?.length) {
      resultSets.push({ rows: res.rows as Record<string, unknown>[] });
    }
  }
  return resultSets;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { client, envFile } = await connectPg({
    requiredProjectRef: PROD_REF,
    envFiles: [
      ".env.local.production-backup-2026-08-25",
      ".env.vercel.production.local",
      ".env.local.backup",
    ],
  });
  console.log(`Release 1 production audits (${envFile})\n`);

  const summary: Record<string, unknown> = { generatedAt: new Date().toISOString() };

  for (const audit of AUDITS) {
    console.log(`=== ${audit.name} ===`);
    let sets: Array<{ rows: Record<string, unknown>[] }>;
    try {
      sets = await runSqlFile(client, audit.file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary[audit.name] = { error: message, note: "Pre–Release 1 schema may lack new tables/functions." };
      console.log("ERROR:", message);
      continue;
    }
    writeFileSync(
      resolve(OUT, `${audit.name}-production.json`),
      JSON.stringify({ resultSets: sets }, null, 2),
    );
    const flat = sets.flatMap((s) => s.rows);
    const byTenant = summarizeByTenant(flat);
    summary[audit.name] = {
      totalRows: flat.length,
      byTenant,
      resultSetCount: sets.length,
    };
    console.log(JSON.stringify(summary[audit.name], null, 2));
  }

  writeFileSync(
    resolve(OUT, "release1-production-audits-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await client.end();
  console.log(`\nWrote summaries to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
