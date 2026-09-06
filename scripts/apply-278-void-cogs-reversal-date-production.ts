/**
 * Apply scripts/278_void_product_sale_cogs_reversal_sale_date.sql to production.
 *   npx tsx scripts/apply-278-void-cogs-reversal-date-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
  });
  console.log(`Connected via ${envFile} (production ${PRODUCTION_REF})`);

  const beforeDef = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'void_product_sale'
  `);
  const before = String(beforeDef.rows[0]?.def ?? "");
  console.log("\n=== BEFORE (COGS reversal date line) ===");
  const beforeLine = before
    .split("\n")
    .find((l) => l.includes("Cost of Goods Sold") || l.includes("CURRENT_DATE"));
  console.log(beforeLine ?? "(see full def if needed)");

  const sql = readFileSync(
    resolve(process.cwd(), "scripts/278_void_product_sale_cogs_reversal_sale_date.sql"),
    "utf8",
  );

  console.log("\nApplying 278_void_product_sale_cogs_reversal_sale_date.sql …");
  await client.query(sql);

  const afterDef = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'void_product_sale'
  `);
  const after = String(afterDef.rows[0]?.def ?? "");
  if (!after.includes("COALESCE(v_sale.date, CURRENT_DATE)")) {
    throw new Error("Function body missing COALESCE(v_sale.date, CURRENT_DATE) for COGS reversal");
  }
  if (after.match(/CURRENT_DATE,\s*'Cost of Goods Sold'/)) {
    throw new Error("Function still uses bare CURRENT_DATE for COGS reversal date");
  }

  console.log("\n=== AFTER (COGS reversal uses sale date) ===");
  const cogsInsertBlock = after
    .split("\n")
    .slice(
      after.split("\n").findIndex((l) => l.includes("IF v_sale.cogs_expense_id")),
      after.split("\n").findIndex((l) => l.includes("RETURNING id INTO v_reversal_expense_id")) + 1,
    )
    .join("\n");
  console.log(cogsInsertBlock);

  console.log("\n=== READ-ONLY: existing voided sales / VOID-COGS (unchanged by migration) ===");
  const dataCheck = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM income_register WHERE entry_type = 'product_sale' AND sale_status = 'voided') AS voided_sales,
      (SELECT COUNT(*)::int FROM expense_register WHERE receipt_no LIKE 'VOID-COGS-%') AS void_cogs_rows,
      (
        SELECT COUNT(*)::int
        FROM income_register i
        JOIN expense_register e ON e.id = i.cogs_reversal_expense_id
        WHERE i.entry_type = 'product_sale'
          AND i.sale_status = 'voided'
          AND e.date IS DISTINCT FROM i.date
      ) AS reversals_dated_differently_from_sale
  `);
  console.log(dataCheck.rows[0]);

  const sample = await client.query(`
    SELECT i.invoice_no, i.date AS sale_date, e.date AS reversal_date, e.amount
    FROM income_register i
    JOIN expense_register e ON e.id = i.cogs_reversal_expense_id
    WHERE i.entry_type = 'product_sale' AND i.sale_status = 'voided'
    ORDER BY i.voided_at DESC NULLS LAST
    LIMIT 5
  `);
  console.log("\nSample voided sales (most recent, dates not modified by 278):");
  console.log(sample.rows);

  console.log(
    "\nPASS: void_product_sale on production uses COALESCE(v_sale.date, CURRENT_DATE) for COGS reversal.",
  );
  console.log(
    "NOTE: Historical VOID-COGS rows keep their original dates; only future voids pick up the fix.",
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
