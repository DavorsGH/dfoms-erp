/**
 * Staging: month-end AP liability + supplier-contract timing + Davors FAP replay.
 *
 *   npx tsx scripts/test-ap-month-end-liability-staging.ts --env-file .env.staging.local
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  calculateAccountsPayableByMonth,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  getPayableOutstandingAsOf,
  isStatutoryRemittancePayable,
} from "../app/dashboard/finance/balance-sheet-ap-cash-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import { getCurrentFinancialYear } from "../app/dashboard/finance/finance-year-utils";
import { getMonthEndDate } from "../app/dashboard/finance/capital-contributions-utils";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const TOLERANCE = 0.01;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function almost(a: number, b: number, tol = TOLERANCE) {
  return Math.abs(a - b) <= tol;
}

function buildMinimalReport(payables, payments, fy, accrualExpenses = []) {
  return buildBalanceSheetReport(
    [],
    accrualExpenses,
    [],
    payables,
    [],
    accrualExpenses.map((e) => ({
      date: e.date,
      expense_category: e.expense_category,
      sub_category: e.sub_category,
      amount: e.amount,
      payment_status: e.payment_status,
      description: e.description ?? null,
      receipt_no: e.receipt_no ?? null,
      notes: e.notes ?? null,
    })),
    [],
    [],
    fy,
    { config: null, rawMaterials: [], finishedProducts: [], finishedProductAverageCosts: [], cashPurchases: [], productCashPurchases: [], valuationHistory: { months: [] } },
    [],
    [],
    [],
    { tenantId: DAVORS, accountsPayablePayments: payments },
  );
}

async function main() {
  let envFile = ".env.staging.local";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;

  loadEnv(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii") || url.includes("staging"), `Refusing non-staging URL: ${url}`);

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const fy = 2098;
  const m1 = 0;
  const m2 = 1;
  const apId = "00000000-0000-4000-8000-00000000ap01";
  const amount = 1600;

  const payables = [
    {
      id: apId,
      invoice_date: `${fy}-01-15`,
      amount,
      amount_paid: amount,
      balance_due: 0,
      vendor_name: "Test Vendor",
      invoice_number: "TEST-M1-M2",
      expense_category: "Administrative",
    },
  ];
  const payments = [
    {
      tenant_id: DAVORS,
      accounts_payable_id: apId,
      payment_date: `${fy}-02-20`,
      amount,
      payment_source: "company_cash" as const,
    },
  ];

  const apByMonth = calculateAccountsPayableByMonth(payables, fy, payments);
  assert(almost(apByMonth[m1], amount), `Month 1 AP expected ${amount}, got ${apByMonth[m1]}`);
  assert(almost(apByMonth[m2], 0), `Month 2 AP expected 0, got ${apByMonth[m2]}`);

  const accrual = [
    {
      date: `${fy}-01-15`,
      expense_category: "Administrative",
      sub_category: "General",
      amount,
      payment_status: "Accrued - Not Yet Paid",
      description: "AP accrual",
      receipt_no: "AP-ACCRUAL-TEST",
      notes: null,
    },
  ];
  const report = buildMinimalReport(payables, payments, fy, accrual);
  assert(getBalanceCheckForPeriod(report, m1).isBalanced, "Month 1 BS should balance with AP liability");
  assert(getBalanceCheckForPeriod(report, m2).isBalanced, "Month 2 BS should balance after payment");

  const janEnd = getMonthEndDate(fy, 1);
  const febEnd = getMonthEndDate(fy, 2);
  assert(
    almost(getPayableOutstandingAsOf(payables[0], janEnd, payments), amount),
    "Jan-end outstanding",
  );
  assert(
    almost(getPayableOutstandingAsOf(payables[0], febEnd, payments), 0),
    "Feb-end outstanding",
  );

  // Supplier contract pattern: invoice 1st, pay next month
  const scApId = "00000000-0000-4000-8000-00000000sc01";
  const scPayables = [
    {
      id: scApId,
      invoice_date: `${fy}-03-01`,
      amount: 500,
      amount_paid: 500,
      balance_due: 0,
      vendor_name: "Contract Vendor",
      invoice_number: "SC-001",
      expense_category: "Direct Operational",
    },
  ];
  const scPayments = [
    {
      tenant_id: DAVORS,
      accounts_payable_id: scApId,
      payment_date: `${fy}-04-10`,
      amount: 500,
      payment_source: "company_cash" as const,
    },
  ];
  const scAp = calculateAccountsPayableByMonth(scPayables, fy, scPayments);
  assert(almost(scAp[2], 500), "March AP stock");
  assert(almost(scAp[3], 0), "April AP stock after pay");
  const scAccrual = [
    {
      date: `${fy}-03-01`,
      expense_category: "Direct Operational",
      sub_category: "General",
      amount: 500,
      payment_status: "Accrued - Not Yet Paid",
      description: "SC accrual",
      receipt_no: "AP-ACCRUAL-SC",
      notes: null,
    },
  ];
  const scReport = buildMinimalReport(scPayables, scPayments, fy, scAccrual);
  assert(getBalanceCheckForPeriod(scReport, 2).isBalanced, "March BS balanced with AP accrual");
  assert(getBalanceCheckForPeriod(scReport, 3).isBalanced, "April BS balanced after SC payment");

  // Legacy AP without payment ledger rows uses current balance_due
  const legacy = [
    {
      invoice_date: `${fy}-05-10`,
      amount: 300,
      amount_paid: 100,
      balance_due: 200,
      vendor_name: "Legacy",
      invoice_number: "LEG-1",
      expense_category: "Administrative",
    },
  ];
  const legacyAp = calculateAccountsPayableByMonth(legacy, fy, []);
  assert(almost(legacyAp[4], 200), "Legacy row uses balance_due for all open months");

  // Davors production FAP scenario on staging live data (if present)
  const liveFy = 2026;
  const data = await fetchBalanceSheetPageData(admin, DAVORS, {
    viewAllBusinessUnits: true,
    activeBusinessUnitId: null,
  });
  assert(!data.fetchError, data.fetchError ?? "fetch failed");
  const fap = (data.initialPayableEntries ?? []).find(
    (p) => (p.invoice_number ?? "").includes("FAP-DF-ASSET"),
  );
  if (fap?.id) {
    const livePayments = (data.initialAccountsPayablePayments ?? []).map((p) => ({
      accounts_payable_id: p.accounts_payable_id,
      payment_date: p.payment_date,
      amount: p.amount,
    }));
    const augEnd = getMonthEndDate(liveFy, 8);
    const sepEnd = getMonthEndDate(liveFy, 9);
    const augOut = getPayableOutstandingAsOf(
      { ...fap, id: fap.id },
      augEnd,
      livePayments,
    );
    const sepOut = getPayableOutstandingAsOf(
      { ...fap, id: fap.id },
      sepEnd,
      livePayments,
    );
    console.log(`FAP-DF-ASSET Aug-end outstanding: ${augOut}, Sep-end: ${sepOut}`);
    const liveReport = buildBalanceSheetReport(
      data.initialIncomeEntries,
      data.initialExpenseEntries,
      data.initialFixedAssets,
      data.initialPayableEntries,
      data.initialCapitalContributions,
      data.initialCashFlowExpenseEntries,
      data.initialPayrollHistory,
      data.initialMonthEndCloseNetPay,
      liveFy,
      data.initialInventoryBalanceSheet,
      data.initialManualEntries,
      data.initialTaxLedgerEntries,
      data.initialWelfareFundEntries,
      {
        tenantId: DAVORS,
        accountsPayablePayments: data.initialAccountsPayablePayments,
        directorsLoanRepayments: data.initialDirectorsLoanRepayments,
      },
    );
    const augDiff = getBalanceCheckForPeriod(liveReport, 7).difference;
    console.log(`Davors staging Aug 2026 BS diff (all BU): ${augDiff}`);
    if (almost(augOut, 1600)) {
      assert(
        almost(augDiff, 0),
        `With correct Aug AP, diff should be 0 (got ${augDiff}); remove duplicate DF-EXP-0034 on staging if still non-zero`,
      );
    }
  } else {
    console.log("Skip FAP live replay: no FAP-DF-ASSET on staging.");
  }

  // Statutory exclusion unchanged
  const stat = {
    id: "00000000-0000-4000-8000-00000000ss01",
    invoice_date: `${fy}-01-01`,
    amount: 999,
    amount_paid: 0,
    balance_due: 999,
    vendor_name: "SSNIT",
    invoice_number: "PAYROLL-SSNIT-1",
    expense_category: "Statutory - SSNIT",
  };
  assert(isStatutoryRemittancePayable(stat), "statutory detect");
  assert(
    almost(
      calculateAccountsPayableByMonth([stat], fy, [
        {
          accounts_payable_id: stat.id,
          payment_date: `${fy}-06-01`,
          amount: 999,
        },
      ])[5],
      0,
    ),
    "statutory excluded from AP liability",
  );

  console.log("\nPASS: AP month-end liability tests");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
