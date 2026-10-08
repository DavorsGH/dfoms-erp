/**
 * Read-only: Davors tenant mutations since 2026-10-07 18:00 UTC (staging).
 * npx tsx scripts/audits/readonly-davors-trace-since-2026-10-07-staging.ts
 */
import { connectPg } from "../lib/pg-connect";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";

const TENANT = "00000001-0000-4000-8000-000000000001";
const FACILITIES = "de215200-e92b-48e3-a7ba-977d7289868c";
const CUTOFF = "2026-10-07T18:00:00Z";
const FY = 2026;

function loadEnvStaging() {
  for (const line of readFileSync(resolve(".env.staging.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`PG via ${envFile}, cutoff ${CUTOFF}\n`);

  const activity = await client.query(
    `
    SELECT created_at, event_name, status, metadata
    FROM user_activity_log
    WHERE tenant_id = $1
      AND created_at >= $2::timestamptz
    ORDER BY created_at ASC
  `,
    [TENANT, CUTOFF],
  );
  console.log(`=== user_activity_log since cutoff (${activity.rowCount} rows) ===`);
  for (const r of activity.rows) {
    console.log(
      r.created_at,
      r.event_name,
      r.status,
      JSON.stringify(r.metadata)?.slice(0, 500),
    );
  }

  const tables: Array<{ label: string; sql: string }> = [
    {
      label: "expense_register (date >= 2026-10-07 OR Oct Facilities)",
      sql: `
        SELECT id, date, amount, expense_category, description, receipt_no, payment_status,
               business_unit_id
        FROM expense_register
        WHERE tenant_id = $1
          AND (
            date >= '2026-10-07'
            OR (business_unit_id = $2 AND date >= '2026-10-01' AND date <= '2026-10-31')
          )
        ORDER BY date, id
      `,
    },
    {
      label: "income_register (date >= 2026-10-07 OR Oct Facilities)",
      sql: `
        SELECT id, date, amount, description, invoice_no, business_unit_id
        FROM income_register
        WHERE tenant_id = $1
          AND (
            date >= '2026-10-07'
            OR (business_unit_id = $2 AND date >= '2026-10-01' AND date <= '2026-10-31')
          )
        ORDER BY date, id
      `,
    },
    {
      label: "salary_advance_register",
      sql: `
        SELECT advance_id, employee_id, amount, date_issued, deduct_payroll_month, business_unit_id,
               created_at, updated_at
        FROM salary_advance_register
        WHERE tenant_id = $1
          AND (created_at >= $2::timestamptz OR updated_at >= $2::timestamptz)
        ORDER BY created_at
      `,
    },
    {
      label: "inventory_stock_adjustment_register_links",
      sql: `
        SELECT *
        FROM inventory_stock_adjustment_register_links
        WHERE tenant_id = $1 AND created_at >= $2::timestamptz
        ORDER BY created_at
      `,
    },
    {
      label: "finished_product_stock_adjustments",
      sql: `
        SELECT id, business_unit_id, adjustment_type, quantity_delta, cost_per_unit, reason, created_at
        FROM finished_product_stock_adjustments
        WHERE tenant_id = $1 AND created_at >= $2::timestamptz
        ORDER BY created_at
      `,
    },
    {
      label: "tax_ledger_entries (source expense/income since cutoff)",
      sql: `
        SELECT id, source_type, source_id, entry_date, leg_kind, amount, business_unit_id, created_at
        FROM tax_ledger_entries
        WHERE tenant_id = $1 AND created_at >= $2::timestamptz
        ORDER BY created_at
      `,
    },
    {
      label: "manual_financial_entries",
      sql: `
        SELECT id, entry_date, amount, entry_type, description, business_unit_id
        FROM manual_financial_entries
        WHERE tenant_id = $1 AND entry_date >= '2026-10-07'
        ORDER BY entry_date
      `,
    },
    {
      label: "product_sales (created since cutoff)",
      sql: `
        SELECT id, sale_number, sale_date, total_amount, business_unit_id, status, created_at
        FROM product_sales
        WHERE tenant_id = $1 AND created_at >= $2::timestamptz
        ORDER BY created_at
      `,
    },
    {
      label: "credit_notes",
      sql: `
        SELECT id, credit_note_number, credit_note_date, total_amount, business_unit_id, created_at
        FROM credit_notes
        WHERE tenant_id = $1 AND created_at >= $2::timestamptz
        ORDER BY created_at
      `,
    },
  ];

  for (const t of tables) {
    const params = t.sql.includes("business_unit_id = $2")
      ? [TENANT, FACILITIES]
      : t.sql.includes("$2::timestamptz")
        ? [TENANT, CUTOFF]
        : [TENANT];
    const { rows } = await client.query(t.sql, params);
    console.log(`\n=== ${t.label}: ${rows.length} rows ===`);
    console.table(rows);
  }

  const orphanTax = await client.query(
    `
    SELECT t.id, t.source_type, t.source_id, t.amount, t.entry_date, t.leg_kind
    FROM tax_ledger_entries t
    WHERE t.tenant_id = $1
      AND t.source_type IN ('expense_register', 'income_register')
      AND NOT EXISTS (
        SELECT 1 FROM expense_register e
        WHERE t.source_type = 'expense_register' AND e.id = t.source_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM income_register i
        WHERE t.source_type = 'income_register' AND i.id = t.source_id
      )
  `,
    [TENANT],
  );
  console.log("\n=== Orphan tax_ledger (missing source row) ===");
  console.table(orphanTax.rows);

  const testDesc = await client.query(
    `
    SELECT 'expense' AS reg, id, date, amount, description, business_unit_id
    FROM expense_register
    WHERE tenant_id = $1 AND (description ILIKE '%Test%' OR amount IN (1, 1.0, 1.5, 2))
    UNION ALL
    SELECT 'income', id, date, amount, description, business_unit_id
    FROM income_register
    WHERE tenant_id = $1 AND (description ILIKE '%Test%' OR amount IN (1, 1.0, 1.5, 2))
    ORDER BY date
  `,
    [TENANT],
  );
  console.log("\n=== Test/small amount rows (all dates) ===");
  console.table(testDesc.rows);

  await client.end();

  loadEnvStaging();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    viewAllBusinessUnits: false,
    activeBusinessUnitId: FACILITIES,
  });
  const report = buildStandardBalanceSheetReport(data, TENANT, FY);
  const sep = 8;
  const oct = 9;
  console.log("\n=== Facilities Sep vs Oct row deltas ===");
  console.log("Sep check:", getBalanceSheetMonthCheck(report, sep));
  console.log("Oct check:", getBalanceSheetMonthCheck(report, oct));
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    const d =
      getBalanceSheetAmountForMonth(row, oct) -
      getBalanceSheetAmountForMonth(row, sep);
    if (Math.abs(d) >= 0.005) {
      console.log(row.key, "delta Sep→Oct", Math.round(d * 100) / 100);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
