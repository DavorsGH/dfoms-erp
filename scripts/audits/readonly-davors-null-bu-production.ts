/**
 * Read-only NULL business_unit_id exposure on PRODUCTION for Davors tenant.
 * npx tsx scripts/audits/readonly-davors-null-bu-production.ts
 */
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";

const TABLES = [
  "income_register",
  "expense_register",
  "accounts_payable",
  "accounts_payable_payments",
  "directors_loan_repayments",
  "directors_loan_entries",
  "manual_financial_entries",
  "capital_contributions",
  "finished_product_balances",
  "raw_material_balances",
  "finished_product_stock_adjustments",
  "raw_material_stock_adjustments",
];

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PROD_REF,
    envFiles: [
      ".env.local.production-backup-2026-08-25",
      ".env.vercel.production.local",
      ".env.local.backup",
    ],
  });
  console.log(`Production read-only (${envFile}, ref ${PROD_REF})\n`);

  for (const table of TABLES) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.${table}
       WHERE tenant_id = $1::uuid AND business_unit_id IS NULL`,
      [TENANT],
    );
    const n = rows[0]?.n ?? 0;
    if (n > 0) {
      console.log(`${table}: ${n} NULL BU rows`);
      const { rows: sample } = await client.query(
        `SELECT * FROM public.${table}
         WHERE tenant_id = $1::uuid AND business_unit_id IS NULL
         LIMIT 5`,
        [TENANT],
      );
      console.log(JSON.stringify(sample, null, 2));
    } else {
      console.log(`${table}: 0`);
    }
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
