/**
 * Read-only: production WAC recompute candidates (revised 370 zero-BU fallback in SQL text).
 * STOP if any row with stock > 0 would get new WAC <= 0.
 *
 * npx tsx scripts/audits/dry-run-370-wac-recompute-production.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const OUT = resolve(
  process.cwd(),
  "scripts/audits/output/dry-run-370-wac-recompute-production.json",
);

const NEW_WAC_SQL = `
  round(
    greatest(
      coalesce(
        CASE
          WHEN fpb.business_unit_id IS NULL
            AND (SELECT count(*)::integer FROM public.business_units bu WHERE bu.tenant_id = fpb.tenant_id) = 0
          THEN public.finished_product_weighted_avg_cost(fpb.product_id)
          ELSE public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id)
        END,
        0
      ),
      0
    ),
    4
  )
`;

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PROD_REF,
    envFiles: [
      ".env.local.production-backup-2026-08-25",
      ".env.vercel.production.local",
      ".env.local.backup",
    ],
  });
  console.log(`370 WAC recompute dry-run PRODUCTION (${envFile})\n`);

  const { rows } = await client.query(`
    SELECT t.name AS tenant,
      t.id AS tenant_id,
      fp.product_code AS product,
      CASE
        WHEN fpb.business_unit_id IS NULL
          AND (SELECT count(*)::integer FROM public.business_units bu WHERE bu.tenant_id = fpb.tenant_id) = 0
        THEN 'whole business'
        WHEN fpb.business_unit_id IS NULL THEN 'NULL BU'
        ELSE coalesce(bu.name, fpb.business_unit_id::text)
      END AS business_unit,
      fpb.current_stock AS stock,
      fpb.average_cost_per_unit AS stored_wac,
      ${NEW_WAC_SQL} AS new_wac
    FROM public.finished_product_balances fpb
    JOIN public.finished_products fp ON fp.id = fpb.product_id
    JOIN public.tenants t ON t.id = fpb.tenant_id
    LEFT JOIN public.business_units bu ON bu.id = fpb.business_unit_id
    WHERE fpb.current_stock > 0
      AND abs(
        coalesce(fpb.average_cost_per_unit, 0)
        - ${NEW_WAC_SQL}
      ) > 0.01
    ORDER BY t.name, fp.product_code, business_unit
  `);

  const bad = rows.filter(
    (r) => Number(r.stock) > 0 && Number(r.new_wac) <= 0,
  );

  console.log(`Rows that would change: ${rows.length}\n`);
  for (const row of rows) {
    console.log(row);
  }

  mkdirSync(resolve(process.cwd(), "scripts/audits/output"), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ rowCount: rows.length, badCount: bad.length, rows, bad }, null, 2),
  );
  console.log(`\nWrote ${OUT}`);

  await client.end();

  if (bad.length > 0) {
    console.error(`STOP: ${bad.length} row(s) with stock > 0 would get new WAC <= 0`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
