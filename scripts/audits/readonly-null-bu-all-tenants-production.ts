/**
 * Read-only NULL business_unit_id counts on PRODUCTION (all tenants).
 * npx tsx scripts/audits/readonly-null-bu-all-tenants-production.ts
 */
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";

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
  "product_purchases",
  "raw_material_purchases",
] as const;

const UNIQUE_TABLES = [...new Set(TABLES)];

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PROD_REF,
    envFiles: [
      ".env.local.production-backup-2026-08-25",
      ".env.vercel.production.local",
      ".env.local.backup",
    ],
  });
  console.log(`Production read-only NULL BU audit (${envFile}, ref ${PROD_REF})\n`);

  const tenants = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM public.tenants ORDER BY name`,
  );

  for (const tenant of tenants.rows) {
    console.log(`\n=== ${tenant.name} (${tenant.id}) ===`);
    for (const table of UNIQUE_TABLES) {
      try {
        const { rows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.${table}
           WHERE tenant_id = $1::uuid AND business_unit_id IS NULL`,
          [tenant.id],
        );
        const n = rows[0]?.n ?? 0;
        if (n === 0) {
          console.log(`  ${table}: 0`);
          continue;
        }
        console.log(`  ${table}: ${n} NULL BU rows`);
        const sample = await client.query(
          `SELECT * FROM public.${table}
           WHERE tenant_id = $1::uuid AND business_unit_id IS NULL
           LIMIT 3`,
          [tenant.id],
        );
        console.log(JSON.stringify(sample.rows, null, 2));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  ${table}: ERROR ${msg}`);
      }
    }

    try {
      const sales = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.income_register
         WHERE tenant_id = $1::uuid AND business_unit_id IS NULL
           AND entry_type = 'product_sale'`,
        [tenant.id],
      );
      console.log(`  income_register (product_sale only): ${sales.rows[0]?.n ?? 0}`);
    } catch (e) {
      console.log(`  income_register product_sale: ERROR ${e}`);
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
