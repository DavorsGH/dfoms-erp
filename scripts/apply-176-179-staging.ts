/**
 * Apply scripts 176–179 to staging (FA credit, AP payments, DL repayments, category seed).
 *
 * Usage: npx tsx scripts/apply-176-179-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const SCRIPTS = [
  "176_fixed_assets_credit_purchases.sql",
  "177_accounts_payable_payments.sql",
  "178_directors_loan_repayments.sql",
  "179_expense_categories_fixed_assets_seed.sql",
];

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
  });
  console.log(`Connected using ${envFile}`);

  try {
    for (const file of SCRIPTS) {
      const sql = readFileSync(resolve(process.cwd(), "scripts", file), "utf8");
      console.log(`\n=== Applying ${file} ===`);
      await client.query(sql);
      console.log(`PASS ${file}`);
    }

    const checks = await client.query(`
      SELECT 'fixed_assets.payment_method' AS check_name,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'fixed_assets'
            AND column_name = 'payment_method'
        ) AS ok
      UNION ALL
      SELECT 'accounts_payable_payments',
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'accounts_payable_payments'
        )
      UNION ALL
      SELECT 'directors_loan_repayments',
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'directors_loan_repayments'
        )
      UNION ALL
      SELECT 'expense_categories Fixed Assets seed',
        EXISTS (
          SELECT 1 FROM expense_categories ec
          JOIN tenants t ON t.id = ec.tenant_id
          WHERE ec.name = 'Fixed Assets'
          GROUP BY ec.name
          HAVING COUNT(*) >= 2
        );
    `);
    console.log("\nSchema checks:", checks.rows);
    for (const row of checks.rows as Array<{ check_name: string; ok: boolean }>) {
      if (!row.ok) {
        throw new Error(`Post-apply check failed: ${row.check_name}`);
      }
    }
    console.log("\nPASS all scripts 176–179 applied on staging");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
