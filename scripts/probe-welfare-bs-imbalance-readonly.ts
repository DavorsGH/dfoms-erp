/**
 * Read-only: Staff Welfare Fund Balance Sheet imbalance probe (Sep 2026).
 *
 * Usage:
 *   npx tsx scripts/probe-welfare-bs-imbalance-readonly.ts --env staging
 *   npx tsx scripts/probe-welfare-bs-imbalance-readonly.ts --env production --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  type BalanceSheetReport,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  calculateStaffWelfareFundBalance,
  calculateStaffWelfarePayableByMonth,
  normalizeStaffWelfareFundEntry,
  STAFF_WELFARE_CONTRIBUTION_CATEGORY,
  STAFF_WELFARE_DISBURSEMENT_CATEGORY,
} from "../app/dashboard/finance/staff-welfare-fund-utils";
import { shouldIncludeExpenseInProfitLoss } from "../app/dashboard/finance/profit-loss-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const SEP_IDX = 8;

const ENV_CONFIG = {
  staging: {
    envFiles: [".env.staging.local"],
    ref: STAGING_REF,
    facilitiesBuId: "de215200-e92b-48e3-a7ba-977d7289868c",
  },
  production: {
    envFiles: [
      ".env.local.production-backup-2026-08-25",
      ".env.local.backup",
      ".env.local",
    ],
    ref: PRODUCTION_REF,
    facilitiesBuId: "608f81b5-38be-4756-8a52-8279c859b07c",
  },
} as const;

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

function loadEnvForTarget(env: "staging" | "production") {
  const cfg = ENV_CONFIG[env];
  let loaded = false;
  for (const file of cfg.envFiles) {
    try {
      loadEnv(resolve(file));
      loaded = true;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      if (supabaseUrl.includes(cfg.ref)) {
        return cfg;
      }
    } catch {
      // try next
    }
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!loaded || !supabaseUrl.includes(cfg.ref)) {
    throw new Error(
      `${env}: could not load env with NEXT_PUBLIC_SUPABASE_URL containing ${cfg.ref}`,
    );
  }
  return cfg;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const env = args.includes("--env")
    ? args[args.indexOf("--env") + 1]
    : "staging";
  if (env !== "staging" && env !== "production") {
    throw new Error("Use --env staging|production");
  }
  if (env === "production" && !args.includes("--allow-production")) {
    throw new Error("Pass --allow-production for production probe");
  }
  return { env: env as "staging" | "production" };
}

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return String(value ?? "").slice(0, 10);
}

async function buildReport(
  admin: ReturnType<typeof createClient>,
  activeBusinessUnitId: string | null,
  viewAll: boolean,
) {
  const page = await fetchBalanceSheetPageData(admin, DAVORS_TENANT_ID, {
    dateRange: null,
    activeBusinessUnitId,
    viewAllBusinessUnits: viewAll,
  });
  if (page.fetchError) throw new Error(page.fetchError);
  return buildBalanceSheetReport(
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
    page.initialWelfareFundEntries,
    {
      tenantId: DAVORS_TENANT_ID,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );
}

function lineAmount(
  report: BalanceSheetReport,
  key: string,
  monthIndex = SEP_IDX,
) {
  const row = report.rows.find((entry) => entry.key === key);
  return row ? r2(getBalanceSheetAmountForMonth(row, monthIndex)) : 0;
}

function lineItems(report: BalanceSheetReport, monthIndex = SEP_IDX) {
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
  const { env } = parseArgs();
  const cfg = loadEnvForTarget(env);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const allReport = await buildReport(admin, null, true);
  const facReport = await buildReport(admin, cfg.facilitiesBuId, false);

  const allCheck = getBalanceCheckForPeriod(allReport, SEP_IDX);
  const facCheck = getBalanceCheckForPeriod(facReport, SEP_IDX);

  const allLines = lineItems(allReport);
  const facLines = lineItems(facReport);
  const facMap = new Map(facLines.map((line) => [line.key, line.amount]));

  const lineDeltas = allLines
    .map((line) => ({
      key: line.key,
      label: line.label,
      side: line.side,
      tenant_wide: line.amount,
      facilities: facMap.get(line.key) ?? 0,
      delta_tenant_minus_facilities: r2(
        line.amount - (facMap.get(line.key) ?? 0),
      ),
    }))
    .filter((line) => Math.abs(line.delta_tenant_minus_facilities) > 0.001)
    .sort(
      (a, b) =>
        Math.abs(b.delta_tenant_minus_facilities) -
        Math.abs(a.delta_tenant_minus_facilities),
    );

  console.log(`=== ${env.toUpperCase()} Sep 2026 balance check ===`);
  console.log(
    JSON.stringify(
      {
        facilities_bu_id: cfg.facilitiesBuId,
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
      },
      null,
      2,
    ),
  );

  console.log("\n=== Key BS lines (Sep 2026) ===");
  const keys = [
    "cash",
    "staff-welfare-payable",
    "retained-earnings",
    "total-assets",
    "total-liabilities",
    "total-equity",
  ];
  console.log(
    JSON.stringify(
      {
        tenant_wide: Object.fromEntries(
          keys.map((key) => [key, lineAmount(allReport, key)]),
        ),
        facilities_only: Object.fromEntries(
          keys.map((key) => [key, lineAmount(facReport, key)]),
        ),
      },
      null,
      2,
    ),
  );

  console.log("\n=== Tenant-wide vs Facilities line deltas (non-zero) ===");
  console.log(JSON.stringify(lineDeltas, null, 2));

  const { data: ledgerRows, error: ledgerError } = await admin
    .from("staff_welfare_fund_ledger")
    .select(
      "id, business_unit_id, entry_date, entry_type, amount, status, source_type, counterparty_name, expense_receipt_no",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .gte("entry_date", "2026-09-01")
    .lte("entry_date", "2026-09-30")
    .order("entry_date");
  if (ledgerError) throw ledgerError;

  const { data: expenseRows, error: expenseError } = await admin
    .from("expense_register")
    .select(
      "id, business_unit_id, date, expense_category, amount, payment_status, receipt_no",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .gte("date", "2026-09-01")
    .lte("date", "2026-09-30")
    .in("expense_category", [
      STAFF_WELFARE_DISBURSEMENT_CATEGORY,
      STAFF_WELFARE_CONTRIBUTION_CATEGORY,
    ])
    .order("date");
  if (expenseError) throw expenseError;

  console.log("\n=== staff_welfare_fund_ledger (Sep 2026) ===");
  console.log(JSON.stringify(ledgerRows, null, 2));

  console.log("\n=== welfare expense_register (Sep 2026) ===");
  console.log(JSON.stringify(expenseRows, null, 2));

  const disbursementSum = (expenseRows ?? [])
    .filter((row) => row.expense_category === STAFF_WELFARE_DISBURSEMENT_CATEGORY)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const contributionSum = (expenseRows ?? [])
    .filter((row) => row.expense_category === STAFF_WELFARE_CONTRIBUTION_CATEGORY)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const { data: fullLedgerRows, error: fullLedgerError } = await admin
    .from("staff_welfare_fund_ledger")
    .select("entry_date, entry_type, amount, status, source_type, counterparty_name")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .neq("status", "reversed")
    .lte("entry_date", "2026-09-30")
    .order("entry_date");
  if (fullLedgerError) throw fullLedgerError;

  const fullNormalized = (fullLedgerRows ?? []).map((row) =>
    normalizeStaffWelfareFundEntry({
      id: "",
      tenant_id: DAVORS_TENANT_ID,
      business_unit_id: null,
      entry_date: toDateString(row.entry_date),
      period_month: null,
      entry_type: row.entry_type,
      amount: Number(row.amount) || 0,
      status: row.status,
      source_type: row.source_type,
      source_id: null,
      employee_id: null,
      counterparty_name: row.counterparty_name,
      notes: null,
      paid_at: null,
      expense_receipt_no: null,
      created_at: "",
      updated_at: "",
    }),
  );

  const sepPayableFull = calculateStaffWelfarePayableByMonth(
    fullNormalized,
    FY,
  )[SEP_IDX];

  const facLedger = (ledgerRows ?? []).filter(
    (row) => row.business_unit_id === cfg.facilitiesBuId,
  );
  const facExpenses = (expenseRows ?? []).filter(
    (row) => row.business_unit_id === cfg.facilitiesBuId,
  );
  const facContributionSum = facExpenses
    .filter((row) => row.expense_category === STAFF_WELFARE_CONTRIBUTION_CATEGORY)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const facDisbursementSum = facExpenses
    .filter((row) => row.expense_category === STAFF_WELFARE_DISBURSEMENT_CATEGORY)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  console.log("\n=== Calculator + accounting reconciliation ===");
  console.log(
    JSON.stringify(
      {
        tenant_wide_bs_staff_welfare_payable: lineAmount(
          allReport,
          "staff-welfare-payable",
        ),
        facilities_bs_staff_welfare_payable: lineAmount(
          facReport,
          "staff-welfare-payable",
        ),
        calculator_on_full_ledger_through_sep: sepPayableFull,
        fund_balance_all_ledger_rows: calculateStaffWelfareFundBalance(
          fullNormalized,
        ),
        sep_disbursement_expense_total: r2(disbursementSum),
        sep_contribution_expense_total: r2(contributionSum),
        facilities_sep_contribution_total: r2(facContributionSum),
        facilities_sep_disbursement_total: r2(facDisbursementSum),
        actual_bs_gap_tenant_wide: r2(allCheck.difference),
        actual_bs_gap_facilities: r2(facCheck.difference),
        gap_equals_contribution_tenant:
          Math.abs(r2(allCheck.difference) - r2(contributionSum)) <= 0.02,
        gap_equals_contribution_facilities:
          Math.abs(r2(facCheck.difference) - r2(facContributionSum)) <= 0.02,
        gap_equals_disbursement_tenant:
          Math.abs(r2(allCheck.difference) + r2(disbursementSum)) <= 0.02,
        facilities_ledger_rows: facLedger,
        facilities_expense_rows: facExpenses,
      },
      null,
      2,
    ),
  );

  console.log("\n=== P&L inclusion on welfare expenses ===");
  console.log(
    JSON.stringify(
      (expenseRows ?? []).map((row) => ({
        receipt_no: row.receipt_no,
        category: row.expense_category,
        amount: r2(Number(row.amount || 0)),
        included_in_pl: shouldIncludeExpenseInProfitLoss(row.expense_category),
        payment_status: row.payment_status,
      })),
      null,
      2,
    ),
  );

  console.log("\n=== Root cause model ===");
  console.log(
    JSON.stringify(
      {
        disbursement_accounting:
          "Cash -X (paid expense), Staff Welfare Payable -X (ledger disbursement), P&L excluded => balanced",
        contribution_accounting:
          "Cash -X (paid expense), Staff Welfare Payable +X (ledger accrual), P&L includes expense => retained earnings -X => L+E net 0 while assets -X => imbalance -X",
        calculator_includes_company_contributions:
          "Yes — entry_type=accrual, status=open adds to liability regardless of counterparty_name",
        confirmed_by_data:
          Math.abs(r2(facCheck.difference) - r2(facContributionSum)) <= 0.02 ||
          Math.abs(r2(allCheck.difference) - r2(contributionSum)) <= 0.02,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
