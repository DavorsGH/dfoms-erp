/**
 * Read-only: production Davors Facilities Sep 2026 BS imbalance probe.
 *
 * Usage:
 *   npx tsx scripts/probe-production-facilities-bs-sep2026-readonly.ts --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  type BalanceSheetReport,
} from "../app/dashboard/finance/balance-sheet-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FACILITIES_BU_ID = "608f81b5-38be-4756-8a52-8279c859b07c";
const FY = 2026;
const SEP_IDX = 8;

const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function buildReport(
  activeBusinessUnitId: string | null,
  viewAll: boolean,
) {
  loadEnv(resolve(".env.local.backup"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const page = await fetchBalanceSheetPageData(admin, DAVORS_TENANT_ID, {
    dateRange: null,
    activeBusinessUnitId,
    viewAllBusinessUnits: viewAll,
  });
  if (page.fetchError) throw new Error(page.fetchError);
  const report = buildBalanceSheetReport(
    page.initialIncomeEntries,
    page.initialExpenseEntries,
    page.initialFixedAssets,
    page.initialPayableEntries,
    page.initialCapitalContributions,
    page.initialCashFlowExpenseEntries,
    page.initialPayrollHistory,
    page.initialMonthEndCloseNetPay,
    FY,
    page.initialInventoryBalanceSheet,
    page.initialManualEntries,
    page.initialTaxLedgerEntries,
    {
      tenantId: DAVORS_TENANT_ID,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );
  return report;
}

function lineItems(report: BalanceSheetReport, monthIndex: number) {
  return report.rows
    .filter((row) => row.kind === "data" || row.kind === "total")
    .map((row) => ({
      key: row.key,
      label: row.label,
      side: row.side,
      amount: r2(getBalanceSheetAmountForMonth(row, monthIndex)),
    }))
    .filter((row) => Math.abs(row.amount) > 0.001);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--allow-production")) {
    throw new Error("Pass --allow-production");
  }

  const allReport = await buildReport(null, true);
  const facilitiesReport = await buildReport(FACILITIES_BU_ID, false);
  const defaultReport = await buildReport(null, false);

  const allCheck = getBalanceCheckForPeriod(allReport, SEP_IDX);
  const facCheck = getBalanceCheckForPeriod(facilitiesReport, SEP_IDX);
  const defCheck = getBalanceCheckForPeriod(defaultReport, SEP_IDX);

  const allLines = lineItems(allReport, SEP_IDX);
  const facLines = lineItems(facilitiesReport, SEP_IDX);
  const defLines = lineItems(defaultReport, SEP_IDX);

  const facMap = new Map(facLines.map((l) => [l.key, l.amount]));
  const allMap = new Map(allLines.map((l) => [l.key, l.amount]));

  const missingOnFacilities = allLines
    .map((l) => ({
      key: l.key,
      label: l.label,
      side: l.side,
      tenant_wide: l.amount,
      facilities: facMap.get(l.key) ?? 0,
      delta_tenant_minus_facilities: r2(l.amount - (facMap.get(l.key) ?? 0)),
    }))
    .filter((l) => Math.abs(l.delta_tenant_minus_facilities) > 0.001)
    .sort(
      (a, b) =>
        Math.abs(b.delta_tenant_minus_facilities) -
        Math.abs(a.delta_tenant_minus_facilities),
    );

  console.log("=== 1) Sep 2026 balance check comparison ===");
  console.log(
    JSON.stringify(
      {
        month_index: SEP_IDX,
        month: "September 2026",
        facilities_bu_id: FACILITIES_BU_ID,
        tenant_wide_all_businesses: {
          assets: allCheck.totalAssets,
          liabilities_and_equity: allCheck.totalLiabilitiesAndEquity,
          difference: r2(allCheck.difference),
          balanced: allCheck.isBalanced,
        },
        davors_facilities_only: {
          assets: facCheck.totalAssets,
          liabilities_and_equity: facCheck.totalLiabilitiesAndEquity,
          difference: r2(facCheck.difference),
          balanced: facCheck.isBalanced,
        },
        workspace_default_null_bu: {
          assets: defCheck.totalAssets,
          liabilities_and_equity: defCheck.totalLiabilitiesAndEquity,
          difference: r2(defCheck.difference),
          balanced: defCheck.isBalanced,
        },
      },
      null,
      2,
    ),
  );

  console.log("\n=== 2) Line items tenant-wide (non-zero, Sep 2026) ===");
  console.log(JSON.stringify(allLines, null, 2));

  console.log("\n=== 2b) Line items Facilities-only (non-zero, Sep 2026) ===");
  console.log(JSON.stringify(facLines, null, 2));

  console.log(
    "\n=== 2c) Lines present tenant-wide but missing/reduced on Facilities (delta) ===",
  );
  console.log(JSON.stringify(missingOnFacilities, null, 2));

  console.log("\n=== 2d) Workspace-default (null BU) non-zero lines ===");
  console.log(JSON.stringify(defLines, null, 2));

  loadEnv(resolve(".env.local.backup"));
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    console.log("\n=== 3) SQL evidence — tax_ledger open output VAT by BU ===");
    const taxVat = await client.query(
      `
        SELECT
          business_unit_id,
          sum(tax_amount)::numeric(18,2) AS output_vat
        FROM tax_ledger_entries
        WHERE tenant_id = $1
          AND status = 'open'
          AND direction = 'output'
          AND entry_date <= '2026-09-30'
        GROUP BY business_unit_id
        ORDER BY business_unit_id NULLS FIRST
      `,
      [DAVORS_TENANT_ID],
    );
    console.log(JSON.stringify(taxVat.rows, null, 2));

    console.log("\n=== 3b) tax_ledger open rows with NULL BU linked to Facilities income ===");
    const taxOrphans = await client.query(
      `
        SELECT
          t.id,
          t.entry_date,
          t.tax_amount,
          t.direction,
          t.business_unit_id AS tax_bu,
          i.id AS income_id,
          i.invoice_no,
          i.date AS income_date,
          i.amount AS income_amount,
          i.business_unit_id AS income_bu
        FROM tax_ledger_entries t
        JOIN income_register i
          ON t.source_type = 'income_register'
         AND t.source_id = i.id::text
        WHERE t.tenant_id = $1
          AND t.status = 'open'
          AND t.business_unit_id IS NULL
          AND i.business_unit_id = $2
          AND t.entry_date <= '2026-09-30'
        ORDER BY t.entry_date, t.tax_amount DESC
      `,
      [DAVORS_TENANT_ID, FACILITIES_BU_ID],
    );
    console.log(JSON.stringify(taxOrphans.rows, null, 2));
    const orphanSum = taxOrphans.rows.reduce(
      (s, r) => s + Number(r.tax_amount || 0),
      0,
    );
    console.log(`orphan_output_vat_sum: ${r2(orphanSum)}`);

    console.log("\n=== 3c) accounts_payable open by BU (Sep cutoff) ===");
    const ap = await client.query(
      `
        SELECT
          business_unit_id,
          count(*)::int AS rows,
          sum(outstanding_amount)::numeric(18,2) AS outstanding
        FROM accounts_payable
        WHERE tenant_id = $1
          AND outstanding_amount > 0
          AND date <= '2026-09-30'
        GROUP BY business_unit_id
        ORDER BY business_unit_id NULLS FIRST
      `,
      [DAVORS_TENANT_ID],
    );
    console.log(JSON.stringify(ap.rows, null, 2));

    console.log("\n=== 3d) manual_financial_entries liability stock by BU ===");
    const manual = await client.query(
      `
        SELECT
          business_unit_id,
          liability_category,
          count(*)::int AS rows,
          sum(amount)::numeric(18,2) AS total
        FROM manual_financial_entries
        WHERE tenant_id = $1
          AND liability_category IS NOT NULL
        GROUP BY business_unit_id, liability_category
        ORDER BY business_unit_id NULLS FIRST, liability_category
      `,
      [DAVORS_TENANT_ID],
    );
    console.log(JSON.stringify(manual.rows, null, 2));

    console.log("\n=== 3e) payroll statutory tax_ledger (PAYE/SSNIT) NULL BU ===");
    const payrollTax = await client.query(
      `
        SELECT
          business_unit_id,
          tax_type,
          sum(tax_amount)::numeric(18,2) AS total
        FROM tax_ledger_entries
        WHERE tenant_id = $1
          AND status = 'open'
          AND tax_type IN ('paye', 'ssnit')
          AND entry_date <= '2026-09-30'
        GROUP BY business_unit_id, tax_type
        ORDER BY business_unit_id NULLS FIRST, tax_type
      `,
      [DAVORS_TENANT_ID],
    );
    console.log(JSON.stringify(payrollTax.rows, null, 2));

    console.log("\n=== 3f) income_register Facilities AR (outstanding) ===");
    const ar = await client.query(
      `
        SELECT
          id,
          invoice_no,
          date,
          amount,
          outstanding_amount,
          output_vat_amount,
          business_unit_id
        FROM income_register
        WHERE tenant_id = $1
          AND business_unit_id = $2
          AND outstanding_amount > 0
          AND date <= '2026-09-30'
        ORDER BY date
      `,
      [DAVORS_TENANT_ID, FACILITIES_BU_ID],
    );
    console.log(JSON.stringify(ar.rows, null, 2));
    const arSum = ar.rows.reduce(
      (s, r) => s + Number(r.outstanding_amount || 0),
      0,
    );
    console.log(`facilities_outstanding_ar_sum: ${r2(arSum)}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
