/**
 * Read-only: classify production voided product sales where VOID-COGS date != sale date,
 * flag month-boundary crossings, and check Balance Sheet for affected tenant/months.
 *
 *   npx tsx scripts/probe-void-cogs-cross-month-production.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const FY = 2026;

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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function monthKey(d: string | Date | null) {
  if (!d) return null;
  const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  return s.slice(0, 7);
}

function monthIndexFromKey(key: string) {
  const month = Number(key.slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return month - 1;
}

async function buildBsCheck(admin, tenantId: string, monthIndex: number) {
  const data = await fetchBalanceSheetPageData(admin, tenantId);
  const liveBundle = await fetchPayrollLiveRecalcBundle(admin, { tenantId });
  const payrollHistory = mergePayrollWagesWithLiveOpenMonths(
    data.initialPayrollHistory,
    data.initialPayrollProcessingRows,
    liveBundle.employees,
    liveBundle.liveContext,
  );
  const cashFlowExpenseEntries = data.initialExpenseEntries.map((entry) => ({
    date: entry.date,
    expense_category: entry.expense_category,
    sub_category: entry.sub_category,
    amount: entry.amount,
    payment_status: entry.payment_status,
    description: entry.description ?? null,
    receipt_no: entry.receipt_no ?? null,
    notes: entry.notes ?? null,
  }));
  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    cashFlowExpenseEntries,
    payrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  const check = getBalanceCheckForPeriod(report, monthIndex);
  return {
    monthIndex,
    totalAssets: r2(report.totalAssets[monthIndex] ?? 0),
    totalLiabilitiesAndEquity: r2(report.totalLiabilitiesAndEquity[monthIndex] ?? 0),
    difference: r2(check.difference),
    balanced: Math.abs(check.difference) < 0.01,
  };
}

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
  });
  console.log(`Connected via ${envFile} (production ${PRODUCTION_REF})\n`);

  const voidRows = await client.query(`
    SELECT
      i.id AS sale_id,
      i.tenant_id,
      t.name AS tenant_name,
      i.invoice_no,
      i.date AS sale_date,
      e.date AS reversal_date,
      e.amount AS reversal_amount,
      e.receipt_no AS reversal_receipt_no,
      orig_cogs.amount AS original_cogs_amount,
      orig_cogs.date AS original_cogs_date,
      orig_cogs.receipt_no AS original_cogs_receipt_no,
      i.voided_at
    FROM income_register i
    JOIN tenants t ON t.id = i.tenant_id
    JOIN expense_register e ON e.id = i.cogs_reversal_expense_id
    LEFT JOIN expense_register orig_cogs ON orig_cogs.id = i.cogs_expense_id
    WHERE i.entry_type = 'product_sale'
      AND i.sale_status = 'voided'
      AND e.date IS DISTINCT FROM i.date
    ORDER BY t.name, i.date, i.invoice_no
  `);

  console.log(`=== ${voidRows.rowCount} voided sales with VOID-COGS date != sale date ===\n`);

  const classified = voidRows.rows.map((row) => {
    const saleMonth = monthKey(row.sale_date);
    const reversalMonth = monthKey(row.reversal_date);
    const sameMonth = saleMonth === reversalMonth;
    const cogsAbs = r2(Math.abs(Number(row.original_cogs_amount ?? row.reversal_amount ?? 0)));
    return {
      ...row,
      sale_month: saleMonth,
      reversal_month: reversalMonth,
      date_relationship: sameMonth ? "SAME_MONTH" : "DIFFERENT_MONTH",
      expected_bs_gap_in_sale_month: sameMonth ? 0 : cogsAbs,
    };
  });

  for (const row of classified) {
    console.log({
      tenant: row.tenant_name,
      tenant_id: row.tenant_id,
      invoice_no: row.invoice_no,
      sale_date: String(row.sale_date).slice(0, 10),
      reversal_date: String(row.reversal_date).slice(0, 10),
      sale_month: row.sale_month,
      reversal_month: row.reversal_month,
      date_relationship: row.date_relationship,
      original_cogs: row.original_cogs_receipt_no
        ? {
            receipt_no: row.original_cogs_receipt_no,
            date: String(row.original_cogs_date).slice(0, 10),
            amount: row.original_cogs_amount,
          }
        : null,
      void_cogs: {
        receipt_no: row.reversal_receipt_no,
        date: String(row.reversal_date).slice(0, 10),
        amount: row.reversal_amount,
      },
      voided_at: row.voided_at ? String(row.voided_at).slice(0, 10) : null,
    });
  }

  const crossMonth = classified.filter((r) => r.date_relationship === "DIFFERENT_MONTH");
  const sameMonth = classified.filter((r) => r.date_relationship === "SAME_MONTH");

  console.log("\n=== Summary ===");
  console.log({
    total_with_different_dates: classified.length,
    same_calendar_month: sameMonth.length,
    crossed_month_boundary: crossMonth.length,
  });

  if (crossMonth.length === 0) {
    console.log(
      "\nNo month-boundary crossings among the 6 voids — sale and VOID-COGS dates differ by day only.",
    );
  } else {
    console.log("\nCross-month voids:");
    for (const row of crossMonth) {
      console.log(
        `  ${row.tenant_name} / ${row.invoice_no}: sale ${row.sale_month} → reversal ${row.reversal_month} (COGS ${row.expected_bs_gap_in_sale_month})`,
      );
    }
  }

  await client.end();

  loadEnv(resolve(".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    loadEnv(resolve(".env.vercel.production.local"));
  }
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const bsTargets = new Map<string, { tenantId: string; tenantName: string; monthKey: string }>();
  for (const row of classified) {
    const saleMk = row.sale_month;
    const revMk = row.reversal_month;
    if (saleMk) {
      bsTargets.set(`${row.tenant_id}|${saleMk}`, {
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        monthKey: saleMk,
      });
    }
    if (revMk && revMk !== saleMk) {
      bsTargets.set(`${row.tenant_id}|${revMk}`, {
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        monthKey: revMk,
      });
    }
  }

  console.log("\n=== Balance Sheet checks (affected tenant/months) ===\n");

  for (const target of [...bsTargets.values()].sort(
    (a, b) => a.tenantName.localeCompare(b.tenantName) || a.monthKey.localeCompare(b.monthKey),
  )) {
    const monthIndex = monthIndexFromKey(target.monthKey);
    if (monthIndex == null) continue;
    const check = await buildBsCheck(admin, target.tenantId, monthIndex);
    const crossMonthForTenant = crossMonth.filter(
      (r) => r.tenant_id === target.tenantId && r.sale_month === target.monthKey,
    );
    const expectedGap = r2(
      crossMonthForTenant.reduce((s, r) => s + r.expected_bs_gap_in_sale_month, 0),
    );
    console.log({
      tenant: target.tenantName,
      month: target.monthKey,
      bs_difference: check.difference,
      balanced: check.balanced,
      total_assets: check.totalAssets,
      total_liabilities_and_equity: check.totalLiabilitiesAndEquity,
      expected_gap_from_cross_month_voids: expectedGap,
      matches_expected_gap:
        crossMonthForTenant.length === 0
          ? "n/a (no cross-month voids in this month)"
          : Math.abs(check.difference - expectedGap) < 0.02,
    });
  }

  if (sameMonth.length > 0) {
    console.log(
      "\nNote: Same-month voids (sale & reversal in one calendar month) should not leave the sale month out of balance from this bug.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
