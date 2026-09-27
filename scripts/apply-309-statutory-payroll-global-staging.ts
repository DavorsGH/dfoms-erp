/**
 * Apply scripts/309_statutory_payroll_global.sql to staging.
 * Usage: npx tsx scripts/apply-309-statutory-payroll-global-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/309_statutory_payroll_global.sql"),
    "utf8",
  );

  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    await client.query(sql);
    console.log("OK: applied scripts/309_statutory_payroll_global.sql on staging");

    const { rows: payeRows } = await client.query(
      `SELECT effective_date, COUNT(*)::int AS band_count
       FROM public.statutory_paye_tax_bands
       WHERE country_code = 'GH'
       GROUP BY effective_date
       ORDER BY effective_date`,
    );
    console.log("PAYE ladders:", payeRows);

    const { rows: policyRows } = await client.query(
      `SELECT tablename, policyname, cmd
       FROM pg_policies
       WHERE tablename IN (
         'statutory_paye_tax_bands',
         'statutory_ssnit_rate_config',
         'statutory_casual_tax_rate_config'
       )
       ORDER BY tablename, policyname`,
    );
    console.log("RLS policies on statutory tables:", policyRows);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
