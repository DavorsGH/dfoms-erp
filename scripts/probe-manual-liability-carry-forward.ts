/**
 * Probe manual liability stock carry-forward (synthetic + optional live tenant).
 *
 * Usage:
 *   npx tsx scripts/probe-manual-liability-carry-forward.ts --synthetic-only
 *   npx tsx scripts/probe-manual-liability-carry-forward.ts --env-file .env.staging.local
 *   npx tsx scripts/probe-manual-liability-carry-forward.ts --env-file .env.local.backup --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import { createEmptyMonthlyTotals } from "../app/dashboard/finance/profit-loss-utils";

const PROD = "tvcurcnmasnocwdxzgvz";
const STAGING = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const YEAR = 2026;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const EMPTY_INV = {
  config: null,
  rawMaterials: [],
  finishedProducts: [],
  finishedProductAverageCosts: [],
  cashPurchases: [],
  productCashPurchases: [],
};

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rowAmount(
  report: { rows: Array<{ key: string; amounts: number[] }> },
  key: string,
  monthIndex: number,
): number {
  return report.rows.find((r) => r.key === key)?.amounts[monthIndex] ?? 0;
}

function buildSyntheticBs(
  manualEntries: Array<{
    period_month: string;
    directors_loan?: number;
    bank_loans?: number;
    other_long_term_liabilities?: number;
    loan_proceeds?: number;
  }>,
  year = YEAR,
) {
  return buildBalanceSheetReport(
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    year,
    EMPTY_INV,
    manualEntries,
    [],
  );
}

function directorsLoanByMonth(
  manualEntries: Parameters<typeof buildSyntheticBs>[0],
  year = YEAR,
) {
  const bs = buildSyntheticBs(manualEntries, year);
  return MONTHS.map((_, i) => r2(rowAmount(bs, "directors-loan", i)));
}

function runSyntheticCarryForwardScenarios() {
  console.log("=== Synthetic carry-forward scenarios (engine) ===");

  // 1. Single August entry — carries Sep–Dec
  const singleAug = directorsLoanByMonth([
    { period_month: "2026-08-01", directors_loan: 1600, loan_proceeds: 1600 },
  ]);
  for (let i = 0; i < 7; i++) {
    assert(singleAug[i] === 0, `Jan–Jul should be 0; month ${i + 1}=${singleAug[i]}`);
  }
  for (let i = 7; i < 12; i++) {
    assert(
      singleAug[i] === 1600,
      `Aug–Dec should be 1600; month ${i + 1}=${singleAug[i]}`,
    );
  }
  console.log("PASS single-month August entry → Sep–Dec carry 1,600");

  // 2. Explicit September zero override (repayment)
  const augThenZero = directorsLoanByMonth([
    { period_month: "2026-08-01", directors_loan: 1600, loan_proceeds: 1600 },
    { period_month: "2026-09-01", directors_loan: 0 },
  ]);
  assert(augThenZero[7] === 1600, "Aug should be 1,600");
  for (let i = 8; i < 12; i++) {
    assert(
      augThenZero[i] === 0,
      `Sep–Dec should be 0 after repayment; month ${i + 1}=${augThenZero[i]}`,
    );
  }
  console.log("PASS explicit Sep zero override clears liability Sep–Dec");

  // 3. Multiple overrides across months
  const multiOverride = directorsLoanByMonth([
    { period_month: "2026-03-01", directors_loan: 500 },
    { period_month: "2026-06-01", directors_loan: 1200 },
    { period_month: "2026-10-01", directors_loan: 800 },
    { period_month: "2026-12-01", directors_loan: 0 },
  ]);
  const expectedMulti = [
    0, 0, 500, 500, 500, 1200, 1200, 1200, 1200, 800, 800, 0,
  ];
  for (let i = 0; i < 12; i++) {
    assert(
      multiOverride[i] === expectedMulti[i],
      `multi-override month ${i + 1}: got ${multiOverride[i]}, want ${expectedMulti[i]}`,
    );
  }
  console.log("PASS multiple overrides across months");

  // 4. BS balances when cash + liability matched (Aug entry only)
  const bs = buildSyntheticBs([
    { period_month: "2026-08-01", directors_loan: 1600, loan_proceeds: 1600 },
  ]);
  for (let i = 7; i < 12; i++) {
    const check = getBalanceCheckForPeriod(bs, i);
    assert(
      check.isBalanced,
      `${MONTHS[i]} should balance; diff=${check.difference}`,
    );
  }
  console.log("PASS Aug entry BS balanced Aug–Dec");

  // 5. Cash Flow unchanged by stock-only field (directors_loan does not drive CF)
  const cfBefore = buildCashFlowReport([], [], []);
  const cfAfter = buildCashFlowReport(
    [],
    [],
    [{ period_month: "2026-08-01", directors_loan: 9999 }],
  );
  const closingBefore = cfBefore.rows.find((r) => r.key === "closing-cash")?.amounts ?? [];
  const closingAfter = cfAfter.rows.find((r) => r.key === "closing-cash")?.amounts ?? [];
  for (let i = 0; i < 13; i++) {
    assert(
      r2(closingBefore[i]) === r2(closingAfter[i]),
      `CF closing cash month ${i} changed by directors_loan stock-only`,
    );
  }
  console.log("PASS Cash Flow closing cash unchanged by directors_loan stock-only");

  console.log("=== All synthetic scenarios PASS ===\n");
}

async function loadBundle(admin, tenantId: string) {
  const [inc, exp, fa, ap, cap, man, pp, mec, tax, ph, live, inv] =
    await Promise.all([
      admin.from("income_register").select("*").eq("tenant_id", tenantId),
      admin.from("expense_register").select("*").eq("tenant_id", tenantId),
      admin.from("fixed_assets").select("*").eq("tenant_id", tenantId),
      admin.from("accounts_payable").select("*").eq("tenant_id", tenantId),
      admin.from("capital_contributions").select("*").eq("tenant_id", tenantId),
      admin.from("manual_financial_entries").select("*").eq("tenant_id", tenantId),
      admin.from("payroll_processing").select("*").eq("tenant_id", tenantId),
      admin.from("month_end_close").select("*").eq("tenant_id", tenantId),
      admin.from("tax_ledger_entries").select("*").eq("tenant_id", tenantId),
      admin
        .from("payroll_history")
        .select("payroll_month, net_pay")
        .eq("tenant_id", tenantId),
      fetchPayrollLiveRecalcBundle(admin, { tenantId }),
      fetchInventoryBalanceSheetInput(admin, tenantId),
    ]);
  const wages = mergePayrollWagesWithLiveOpenMonths(
    ph.data ?? [],
    pp.data ?? [],
    live.employees,
    live.liveContext,
  );
  const cashFlow = (exp.data ?? []).map((e) => ({
    date: e.date,
    expense_category: e.expense_category ?? "",
    sub_category: e.sub_category ?? "",
    amount: e.amount,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));
  return {
    income: inc.data ?? [],
    expenses: exp.data ?? [],
    fixedAssets: fa.data ?? [],
    payables: ap.data ?? [],
    capital: cap.data ?? [],
    manual: man.data ?? [],
    monthEndClose: mec.data ?? [],
    taxLedger: tax.data ?? [],
    wages,
    cashFlow,
    inv,
  };
}

function buildLiveBs(bundle: Awaited<ReturnType<typeof loadBundle>>) {
  return buildBalanceSheetReport(
    bundle.income,
    bundle.expenses,
    bundle.fixedAssets,
    bundle.payables,
    bundle.capital,
    bundle.cashFlow,
    bundle.wages,
    bundle.monthEndClose,
    YEAR,
    bundle.inv,
    bundle.manual,
    bundle.taxLedger,
  );
}

async function runLiveTenantProbe(admin, tenantId: string, label: string) {
  const bundle = await loadBundle(admin, tenantId);

  console.log(`\n=== manual_financial_entries (${label}, FY${YEAR}) ===`);
  for (const row of [...bundle.manual].sort((a, b) =>
    String(a.period_month).localeCompare(String(b.period_month)),
  )) {
    if (!String(row.period_month).startsWith(String(YEAR))) continue;
    console.log({
      period_month: row.period_month,
      bank_loans: row.bank_loans,
      other_long_term_liabilities: row.other_long_term_liabilities,
      directors_loan: row.directors_loan,
      loan_proceeds: row.loan_proceeds,
    });
  }

  const bs = buildLiveBs(bundle);

  console.log(`\n=== BS diff by month (${label}, engine with carry-forward) ===`);
  for (let i = 0; i < 12; i++) {
    const c = getBalanceCheckForPeriod(bs, i);
    const dl = r2(rowAmount(bs, "directors-loan", i));
    console.log(
      `${MONTHS[i]}: diff=${r2(c.difference).toFixed(2)} directors_loan=${dl.toFixed(2)} balanced=${c.isBalanced}`,
    );
  }

  return bs;
}

async function runCaantaEphemeralCarryForwardTest(admin) {
  const EPHEMERAL_YEAR = 2099;
  const AUG = `${EPHEMERAL_YEAR}-08-01`;
  const TEST_AMOUNT = 4321.09;
  const STAMP = `CARRY-FWD-PROBE-${Date.now()}`;

  console.log("\n=== Caanta ephemeral carry-forward (2099 Aug → Sep–Dec) ===");

  const { data: existing } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", CAANTA)
    .eq("period_month", AUG)
    .maybeSingle();

  const prior = existing
    ? {
        directors_loan: Number(existing.directors_loan) || 0,
        bank_loans: Number(existing.bank_loans) || 0,
        loan_proceeds: Number(existing.loan_proceeds) || 0,
        notes: existing.notes ?? null,
      }
    : null;

  try {
    if (prior) {
      await admin
        .from("manual_financial_entries")
        .update({
          directors_loan: TEST_AMOUNT,
          bank_loans: TEST_AMOUNT,
          loan_proceeds: TEST_AMOUNT,
          notes: STAMP,
        })
        .eq("tenant_id", CAANTA)
        .eq("period_month", AUG);
    } else {
      await admin.from("manual_financial_entries").insert({
        tenant_id: CAANTA,
        period_month: AUG,
        directors_loan: TEST_AMOUNT,
        bank_loans: TEST_AMOUNT,
        loan_proceeds: TEST_AMOUNT,
        notes: STAMP,
      });
    }

    const bundle = await loadBundle(admin, CAANTA);
    const bs = buildBalanceSheetReport(
      bundle.income,
      bundle.expenses,
      bundle.fixedAssets,
      bundle.payables,
      bundle.capital,
      bundle.cashFlow,
      bundle.wages,
      bundle.monthEndClose,
      EPHEMERAL_YEAR,
      bundle.inv,
      bundle.manual,
      bundle.taxLedger,
    );

    for (const monthIndex of [7, 8, 9, 10, 11]) {
      const dl = r2(rowAmount(bs, "directors-loan", monthIndex));
      const bl = r2(rowAmount(bs, "bank-loans", monthIndex));
      assert(
        dl === TEST_AMOUNT,
        `Caanta ${MONTHS[monthIndex]} directors_loan=${dl}, want ${TEST_AMOUNT}`,
      );
      assert(
        bl === TEST_AMOUNT,
        `Caanta ${MONTHS[monthIndex]} bank_loans=${bl}, want ${TEST_AMOUNT}`,
      );
    }
    console.log("PASS Caanta Aug 2099 entry carries directors_loan + bank_loans Sep–Dec");
  } finally {
    if (prior) {
      await admin
        .from("manual_financial_entries")
        .update({
          directors_loan: prior.directors_loan,
          bank_loans: prior.bank_loans,
          loan_proceeds: prior.loan_proceeds,
          notes: prior.notes,
        })
        .eq("tenant_id", CAANTA)
        .eq("period_month", AUG);
    } else {
      await admin
        .from("manual_financial_entries")
        .delete()
        .eq("tenant_id", CAANTA)
        .eq("period_month", AUG);
    }
    console.log("Caanta ephemeral row restored/deleted");
  }
}

async function main() {
  runSyntheticCarryForwardScenarios();

  if (process.argv.includes("--synthetic-only")) {
    return;
  }

  const envIdx = process.argv.indexOf("--env-file");
  const envFile = envIdx >= 0 ? process.argv[envIdx + 1] : ".env.staging.local";
  const allowProd = process.argv.includes("--allow-production");
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url.includes(PROD) && !allowProd) {
    throw new Error("Production ref detected — pass --allow-production for live probe");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await runLiveTenantProbe(admin, DAVORS, "Davors");

  if (url.includes(STAGING)) {
    await runCaantaEphemeralCarryForwardTest(admin);
    await runLiveTenantProbe(admin, CAANTA, "Caanta (live FY2026 data)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
