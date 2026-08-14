/**
 * Apply scripts/217_client_quotations_ship_to_internal_notes_payment_terms.sql to production.
 *
 * Usage: npx tsx scripts/apply-217-client-quotations-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const EXPECTED_COLUMNS = [
  "internal_notes",
  "payment_terms",
  "ship_to_address",
  "ship_to_name",
  "ship_to_phone",
] as const;

async function verify217(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const { rows: columnRows } = await client.query(`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_quotations'
      AND column_name = ANY($1::text[])
    ORDER BY column_name
  `, [EXPECTED_COLUMNS]);

  const found = columnRows.map((row) => String(row.column_name));
  const missing = EXPECTED_COLUMNS.filter((name) => !found.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing columns on client_quotations: ${missing.join(", ")}`);
  }

  console.log("PASS 217: all 5 columns present on client_quotations:");
  for (const row of columnRows) {
    console.log(
      `  - ${row.column_name} (nullable=${row.is_nullable}, default=${row.column_default ?? "none"})`,
    );
  }

  const { rows: backfillRows } = await client.query(`
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (WHERE payment_terms IS NULL)::int AS null_payment_terms,
      COUNT(*) FILTER (WHERE payment_terms = 'Net 30')::int AS net_30_rows,
      COUNT(*) FILTER (WHERE payment_terms IS DISTINCT FROM 'Net 30')::int AS other_payment_terms
    FROM public.client_quotations
  `);

  const stats = backfillRows[0] as {
    total_rows: number;
    null_payment_terms: number;
    net_30_rows: number;
    other_payment_terms: number;
  };

  console.log("PASS 217: payment_terms backfill stats:");
  console.log(`  total_rows=${stats.total_rows}`);
  console.log(`  null_payment_terms=${stats.null_payment_terms}`);
  console.log(`  net_30_rows=${stats.net_30_rows}`);
  console.log(`  other_payment_terms=${stats.other_payment_terms}`);

  if (stats.null_payment_terms > 0) {
    throw new Error(
      `${stats.null_payment_terms} client_quotations row(s) still have NULL payment_terms`,
    );
  }

  if (stats.total_rows > 0 && stats.net_30_rows !== stats.total_rows) {
    throw new Error(
      `Expected all existing rows to have payment_terms='Net 30' after backfill; ` +
        `got net_30_rows=${stats.net_30_rows}, total_rows=${stats.total_rows}`,
    );
  }
}

async function main() {
  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
  });

  console.log(`Connected to production via ${envFile} (candidate ${candidateIndex})`);

  const sql = readFileSync(
    resolve("scripts/217_client_quotations_ship_to_internal_notes_payment_terms.sql"),
    "utf8",
  );

  try {
    await client.query(sql);
    console.log(
      "OK: applied scripts/217_client_quotations_ship_to_internal_notes_payment_terms.sql on production",
    );
    await verify217(client);
    console.log("ALL PASS — migration 217 applied and verified on production");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
