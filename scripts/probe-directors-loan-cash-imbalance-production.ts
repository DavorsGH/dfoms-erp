/**
 * Read-only: Director's Loan / cash imbalance diagnosis (production).
 *
 *   npx tsx scripts/probe-directors-loan-cash-imbalance-production.ts --env-file .env.local.backup
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import { buildNetPayByPayrollMonth } from "../app/dashboard/finance/accrued-wages-utils";
import { filterManualEntriesForYear } from "../app/dashboard/finance/cash-flow-utils";
import {
  DIRECTORS_LOAN_LEDGER_SELECT,
  isNonCashDirectorsLoanLedgerEntry,
} from "../app/dashboard/finance/directors-loan-ledger-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const LOGISTICS_BU = "2ae591d2-0f89-44d0-83af-1133cfe7a32c";
const FY = 2026;
const MONTHS = [8, 9, 10, 11] as const; // Sep–Dec (0-based index)

function loadEnv(file: string) {
  for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function getArg(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(flag);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}

function rowAmt(report: { rows: Array<{ key: string; amounts: number[] }> }, key: string, mi: number) {
  return report.rows.find((r) => r.key === key)?.amounts[mi] ?? 0;
}

async function main() {
  const envFile = getArg("--env-file") ?? ".env.local.backup";
  loadEnv(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error("Refusing: not production URL");
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: ledgerRows } = await admin
    .from("directors_loan_entries")
    .select(DIRECTORS_LOAN_LEDGER_SELECT)
    .eq("tenant_id", TENANT)
    .order("entry_date");

  console.log("\n=== directors_loan_entries (tenant) ===");
  for (const e of ledgerRows ?? []) {
    console.log(
      JSON.stringify({
        id: e.id,
        bu: e.business_unit_id,
        date: e.entry_date,
        type: e.entry_type,
        amount: e.amount,
        reference: e.reference,
        non_cash: isNonCashDirectorsLoanLedgerEntry(e),
        reversed_at: e.reversed_at,
      }),
    );
  }

  const { data: manuals } = await admin
    .from("manual_financial_entries")
    .select(
      "id, period_month, business_unit_id, bank_loans, loan_proceeds, loan_repayments, directors_loan",
    )
    .eq("tenant_id", TENANT)
    .gte("period_month", "2026-08-01")
    .lte("period_month", "2026-12-01");

  console.log("\n=== manual_financial_entries (Aug–Dec 2026) ===");
  for (const m of manuals ?? []) {
    if (
      m.business_unit_id === LOGISTICS_BU ||
      m.business_unit_id == null ||
      String(m.period_month).startsWith("2026-08")
    ) {
      console.log(JSON.stringify(m));
    }
  }

  const { data: repayments } = await admin
    .from("directors_loan_repayments")
    .select("*")
    .eq("tenant_id", TENANT)
    .gte("repayment_date", "2026-08-01")
    .lte("repayment_date", "2026-12-31");

  console.log("\n=== directors_loan_repayments (Aug–Dec 2026) ===");
  for (const r of repayments ?? []) {
    console.log(JSON.stringify(r));
  }

  for (const scope of [
    { label: "Logistics", bu: LOGISTICS_BU },
    { label: "All businesses", bu: null as string | null, all: true },
  ]) {
    const data = await fetchBalanceSheetPageData(admin, TENANT, {
      viewAllBusinessUnits: scope.all ?? false,
      activeBusinessUnitId: scope.all ? null : scope.bu,
    });
    const ledger = data.initialDirectorsLoanLedgerEntries ?? [];
    const manual = filterManualEntriesForYear(data.initialManualEntries, FY);
    const staffSalary = buildNetPayByPayrollMonth(
      data.initialPayrollHistory,
      data.initialMonthEndCloseNetPay,
    );
    const opts = {
      tenantId: TENANT,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
      directorsLoanLedgerEntries: ledger,
      allBusinessUnitsDirectorsLoan: scope.all ?? false,
    };
    const bs = buildBalanceSheetReport(
      data.initialIncomeEntries,
      data.initialExpenseEntries,
      data.initialFixedAssets,
      data.initialPayableEntries,
      data.initialCapitalContributions,
      data.initialCashFlowExpenseEntries,
      data.initialPayrollHistory,
      data.initialMonthEndCloseNetPay,
      FY,
      data.initialInventoryBalanceSheet,
      manual,
      data.initialTaxLedgerEntries,
      data.initialWelfareFundEntries,
      opts,
    );
    const cf = buildCashFlowReport(
      data.initialCashFlowIncomeEntries,
      data.initialCashFlowExpenseEntries,
      manual,
      FY,
      {
        rawMaterialCashPurchases: data.initialInventoryBalanceSheet.cashPurchases ?? [],
        productCashPurchases: data.initialInventoryBalanceSheet.productCashPurchases ?? [],
        inventoryConfig: data.initialInventoryBalanceSheet.config,
      },
      data.initialFixedAssets,
      data.initialCapitalContributions,
      staffSalary,
      data.initialPayableEntries,
      opts,
    );

    console.log(`\n=== Balance sheet — ${scope.label} (Sep–Dec 2026) ===`);
    const keys = [
      "cash",
      "directors-loan",
      "due-from-director",
      "total-assets",
      "total-liabilities-and-equity",
    ];
    for (const mi of MONTHS) {
      const check = getBalanceCheckForPeriod(bs, mi);
      const line: Record<string, number> = { month: mi + 1, imbalance: check.difference };
      for (const k of keys) line[k] = rowAmt(bs, k, mi);
      console.log(JSON.stringify(line));
    }

    console.log(`\n=== Cash flow components — ${scope.label} (Sep–Dec) ===`);
    for (const mi of MONTHS) {
      console.log(
        JSON.stringify({
          month: mi + 1,
          "loan-proceeds": rowAmt(cf, "loan-proceeds", mi),
          "directors-loan-inflows": rowAmt(cf, "directors-loan-inflows", mi),
          "loan-repayments": rowAmt(cf, "loan-repayments", mi),
          "directors-loan-repayments": rowAmt(cf, "directors-loan-repayments", mi),
        }),
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
