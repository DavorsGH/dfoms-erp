/**
 * Read-only: row-level trace for Nextronics Oct 2026 BS gap (GHS 55).
 * npx tsx scripts/audits/nextronics-oct-55-trace-production.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const FY = 2026;
const OCT = 9;

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv(".env.local.production-backup-2026-08-25");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { client } = await connectPg({
    requiredProjectRef: PROD_REF,
    envFiles: [".env.local.production-backup-2026-08-25"],
  });

  const { rows: trows } = await client.query(
    `SELECT id, name FROM tenants WHERE name ILIKE '%Nextronics%' LIMIT 1`,
  );
  const tenantId = trows[0].id as string;

  for (const mi of [8, 9]) {
    const data = await fetchBalanceSheetPageData(admin, tenantId, {
      viewAllBusinessUnits: true,
      dateRange: null,
    });
    const report = buildStandardBalanceSheetReport(data, tenantId, FY, {
      allBusinessUnitsDirectorsLoan: true,
      rawManualFinancialEntries: data.initialRawManualEntries,
    });
    console.log(`Month ${mi + 1}:`, getBalanceSheetMonthCheck(report, mi));
  }

  const sepEnd = "2026-09-30";
  const octEnd = "2026-10-31";

  const { rows: octEvents } = await client.query(
    `WITH events AS (
      SELECT 'sale' AS kind, i.id::text AS row_id, i.date AS d, i.invoice_no AS ref,
        i.amount AS revenue, e.amount AS cogs, i.product_id::text AS product_id
      FROM income_register i
      LEFT JOIN expense_register e ON e.id = i.cogs_expense_id
      WHERE i.tenant_id = $1 AND i.entry_type = 'product_sale'
        AND i.date >= '2026-10-01' AND i.date <= '2026-10-31'
      UNION ALL
      SELECT 'fp_adj', fsa.id::text, fsa.created_at::date, fsa.adjustment_type,
        fsa.quantity_delta * fsa.cost_per_unit, 0, fsa.product_id::text
      FROM finished_product_stock_adjustments fsa
      WHERE fsa.tenant_id = $1
        AND fsa.created_at::date >= '2026-10-01' AND fsa.created_at::date <= '2026-10-31'
      UNION ALL
      SELECT 'purchase', pp.id::text, pp.purchase_date, 'product_purchase',
        pp.total_cost, 0, pp.product_id::text
      FROM product_purchases pp
      WHERE pp.tenant_id = $1
        AND pp.purchase_date >= '2026-10-01' AND pp.purchase_date <= '2026-10-31'
      UNION ALL
      SELECT 'expense_pl', er.id::text, er.date, er.sub_category,
        0, er.amount, NULL::text
      FROM expense_register er
      WHERE er.tenant_id = $1
        AND er.date >= '2026-10-01' AND er.date <= '2026-10-31'
        AND er.sub_category ILIKE '%cost of goods%'
    )
    SELECT * FROM events ORDER BY d, kind`,
    [tenantId],
  );

  const { rows: plOct } = await client.query(
    `SELECT coalesce(sum(er.amount),0) AS expense_total
     FROM expense_register er
     WHERE er.tenant_id = $1 AND er.date >= '2026-10-01' AND er.date <= '2026-10-31'
       AND er.sub_category = 'Cost of Goods Sold'`,
    [tenantId],
  );

  const { rows: invHistoryGap } = await client.query(
    `SELECT fp.product_code,
      sum(CASE WHEN e.amount IS NOT NULL THEN e.amount ELSE 0 END) AS oct_cogs_booked
     FROM income_register i
     JOIN finished_products fp ON fp.id = i.product_id
     LEFT JOIN expense_register e ON e.id = i.cogs_expense_id
     WHERE i.tenant_id = $1 AND i.date >= '2026-10-01' AND i.date <= '2026-10-31'
       AND i.entry_type = 'product_sale'
     GROUP BY fp.product_code ORDER BY oct_cogs_booked DESC`,
    [tenantId],
  );

  let adjLinks: Record<string, unknown>[] = [];
  try {
    adjLinks = (
      await client.query(
        `SELECT fsa.id, fsa.adjustment_type, fsa.created_at::date AS d,
        fsa.quantity_delta * fsa.cost_per_unit AS value,
        l.id IS NOT NULL AS has_pl_link
       FROM finished_product_stock_adjustments fsa
       LEFT JOIN inventory_stock_adjustment_register_links l
         ON l.adjustment_id = fsa.id AND l.tenant_id = fsa.tenant_id AND l.source_kind = 'finished'
       WHERE fsa.tenant_id = $1 AND fsa.created_at::date >= '2026-10-01'
       ORDER BY fsa.created_at`,
        [tenantId],
      )
    ).rows;
  } catch {
    adjLinks = (
      await client.query(
        `SELECT fsa.id, fsa.adjustment_type, fsa.created_at::date AS d,
          fsa.quantity_delta * fsa.cost_per_unit AS value,
          false AS has_pl_link
         FROM finished_product_stock_adjustments fsa
         WHERE fsa.tenant_id = $1 AND fsa.created_at::date >= '2026-10-01'
         ORDER BY fsa.created_at`,
        [tenantId],
      )
    ).rows;
  }

  const payload = {
    tenantId,
    sepEnd,
    octEnd,
    octEvents,
    plOctCogs: plOct[0],
    octCogsByProduct: invHistoryGap,
    octAdjustments: adjLinks,
    hypothesis:
      "Gap opens Oct 2026 (Sep balanced). Compare inventory carrying-value history vs P&L COGS + adjustment register links in October.",
  };

  mkdirSync(resolve("scripts/audits/output"), { recursive: true });
  const outPath = resolve("scripts/audits/output/nextronics-oct-55-trace-production.json");
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log("Wrote", outPath);
  console.log(JSON.stringify(payload, null, 2).slice(0, 8000));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
