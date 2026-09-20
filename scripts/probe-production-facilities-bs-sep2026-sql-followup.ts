/**
 * Read-only SQL follow-up: production Facilities Sep 2026 BS gap decomposition.
 * npx tsx scripts/probe-production-facilities-bs-sep2026-sql-followup.ts
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const T = "00000001-0000-4000-8000-000000000001";
const F = "608f81b5-38be-4756-8a52-8279c859b07c";

function load(p: string) {
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  load(".env.local.backup");
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    const taxByDir = await c.query(
      `SELECT direction, business_unit_id,
              sum(tax_amount)::numeric(18,2) AS total
       FROM tax_ledger_entries
       WHERE tenant_id = $1 AND status = 'open' AND entry_date <= '2026-09-30'
       GROUP BY direction, business_unit_id ORDER BY 1, 2 NULLS FIRST`,
      [T],
    );
    console.log("=== tax_ledger by direction + BU ===");
    console.log(JSON.stringify(taxByDir.rows, null, 2));

    const payeSsnit = await c.query(
      `SELECT business_unit_id, tax_component, sum(tax_amount)::numeric(18,2) AS total
       FROM tax_ledger_entries
       WHERE tenant_id = $1 AND status = 'open' AND direction = 'statutory_payable'
         AND entry_date <= '2026-09-30'
       GROUP BY business_unit_id, tax_component ORDER BY 1 NULLS FIRST, 2`,
      [T],
    );
    console.log("\n=== statutory_payable (PAYE/SSNIT) by BU ===");
    console.log(JSON.stringify(payeSsnit.rows, null, 2));

    const orphanTax = await c.query(
      `SELECT t.id, t.entry_date, t.direction, t.tax_component, t.tax_amount,
              t.business_unit_id AS tax_bu, i.invoice_no, i.business_unit_id AS income_bu
       FROM tax_ledger_entries t
       JOIN income_register i ON t.source_type = 'income_register' AND t.source_id::text = i.id::text
       WHERE t.tenant_id = $1 AND t.status = 'open' AND t.business_unit_id IS NULL
         AND i.business_unit_id = $2 AND t.entry_date <= '2026-09-30'
       ORDER BY t.entry_date`,
      [T, F],
    );
    console.log("\n=== orphan tax (NULL tax_bu, Facilities income_bu) ===");
    console.log(JSON.stringify(orphanTax.rows, null, 2));
    const orphanByDir = orphanTax.rows.reduce(
      (acc: Record<string, number>, r) => {
        acc[r.direction] = (acc[r.direction] || 0) + Number(r.tax_amount);
        return acc;
      },
      {},
    );
    console.log("orphan_by_direction:", orphanByDir);
    console.log(
      "orphan_net_vat_minus_wht:",
      (orphanByDir.output || 0) - (orphanByDir.wht_receivable || 0),
    );

    const ap = await c.query(
      `SELECT business_unit_id, count(*)::int AS rows,
              sum(balance_due)::numeric(18,2) AS balance_due
       FROM accounts_payable
       WHERE tenant_id = $1 AND balance_due > 0 AND invoice_date <= '2026-09-30'
       GROUP BY business_unit_id ORDER BY 1 NULLS FIRST`,
      [T],
    );
    console.log("\n=== accounts_payable open by BU ===");
    console.log(JSON.stringify(ap.rows, null, 2));

    const apRows = await c.query(
      `SELECT id, invoice_number, vendor_name, invoice_date, amount, balance_due, business_unit_id
       FROM accounts_payable
       WHERE tenant_id = $1 AND balance_due > 0 AND invoice_date <= '2026-09-30'`,
      [T],
    );
    console.log("\n=== accounts_payable open rows ===");
    console.log(JSON.stringify(apRows.rows, null, 2));

    const fixed = await c.query(
      `SELECT business_unit_id, count(*)::int AS rows,
              sum(original_cost)::numeric(18,2) AS original_cost
       FROM fixed_assets WHERE tenant_id = $1 GROUP BY business_unit_id ORDER BY 1 NULLS FIRST`,
      [T],
    );
    console.log("\n=== fixed_assets by BU ===");
    console.log(JSON.stringify(fixed.rows, null, 2));

    const cap = await c.query(
      `SELECT business_unit_id, count(*)::int AS rows, sum(amount)::numeric(18,2) AS total
       FROM capital_contributions WHERE tenant_id = $1
       GROUP BY business_unit_id ORDER BY 1 NULLS FIRST`,
      [T],
    );
    console.log("\n=== capital_contributions (share capital) by BU ===");
    console.log(JSON.stringify(cap.rows, null, 2));

    const expPayroll = await c.query(
      `SELECT business_unit_id, expense_category, count(*)::int AS rows,
              sum(amount)::numeric(18,2) AS total
       FROM expense_register
       WHERE tenant_id = $1 AND expense_category ILIKE '%payroll%'
         AND date <= '2026-09-30'
       GROUP BY business_unit_id, expense_category ORDER BY 1 NULLS FIRST, 2`,
      [T],
    );
    console.log("\n=== expense_register payroll-related by BU ===");
    console.log(JSON.stringify(expPayroll.rows, null, 2));

    const mec = await c.query(
      `SELECT month, lock_status, business_unit_id, employees_recorded, total_net_pay
       FROM month_end_close WHERE tenant_id = $1 AND month <= '2026-09-30'
       ORDER BY month`,
      [T],
    );
    console.log("\n=== month_end_close through Sep 2026 ===");
    console.log(JSON.stringify(mec.rows, null, 2));

    const incomeBu = await c.query(
      `SELECT business_unit_id, count(*)::int AS rows,
              sum(amount)::numeric(18,2) AS total_amount
       FROM income_register WHERE tenant_id = $1 AND date <= '2026-09-30'
       GROUP BY business_unit_id ORDER BY 1 NULLS FIRST`,
      [T],
    );
    console.log("\n=== income_register by BU ===");
    console.log(JSON.stringify(incomeBu.rows, null, 2));

    const incomeRows = await c.query(
      `SELECT invoice_no, date, amount, business_unit_id
       FROM income_register WHERE tenant_id = $1 AND date <= '2026-09-30'
       ORDER BY date`,
      [T],
    );
    console.log("\n=== income_register rows ===");
    console.log(JSON.stringify(incomeRows.rows, null, 2));

    const expByBu = await c.query(
      `SELECT business_unit_id, expense_category, count(*)::int AS rows,
              sum(amount)::numeric(18,2) AS total
       FROM expense_register WHERE tenant_id = $1 AND date <= '2026-09-30'
       GROUP BY business_unit_id, expense_category ORDER BY 1 NULLS FIRST, 2`,
      [T],
    );
    console.log("\n=== expense_register by BU + category ===");
    console.log(JSON.stringify(expByBu.rows, null, 2));

    const nullBuCounts = await c.query(
      `SELECT 'tax_ledger_entries' AS tbl, count(*)::int AS null_bu_rows
       FROM tax_ledger_entries WHERE tenant_id = $1 AND business_unit_id IS NULL
       UNION ALL
       SELECT 'accounts_payable', count(*)::int FROM accounts_payable
         WHERE tenant_id = $1 AND business_unit_id IS NULL
       UNION ALL
       SELECT 'expense_register', count(*)::int FROM expense_register
         WHERE tenant_id = $1 AND business_unit_id IS NULL
       UNION ALL
       SELECT 'fixed_assets', count(*)::int FROM fixed_assets
         WHERE tenant_id = $1 AND business_unit_id IS NULL
       UNION ALL
       SELECT 'capital_contributions', count(*)::int FROM capital_contributions
         WHERE tenant_id = $1 AND business_unit_id IS NULL
       UNION ALL
       SELECT 'income_register', count(*)::int FROM income_register
         WHERE tenant_id = $1 AND business_unit_id IS NULL`,
      [T],
    );
    console.log("\n=== NULL business_unit_id row counts ===");
    console.log(JSON.stringify(nullBuCounts.rows, null, 2));
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
