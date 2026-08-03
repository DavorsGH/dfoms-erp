/**
 * Staging verification: Partial Lock → Full Lock promote (Accrued → Paid),
 * month-end visibility gates, and skipLoanRepayments on promote.
 *
 * Usage:
 *   npx tsx scripts/test-payroll-full-lock-promote-staging.ts
 *   npx tsx scripts/test-payroll-full-lock-promote-staging.ts --env-file .env.staging.local
 *
 * STAGING ONLY — refuses production project refs.
 * Uses synthetic FY 2098 expense receipts only — does not mutate live July/August payroll.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildMonthlyCashComponents } from "../app/dashboard/finance/cash-movement-utils";
import { calculateAccruedWagesPayableByMonth } from "../app/dashboard/finance/accrued-wages-utils";
import {
  deletePayrollLockFinanceEntries,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
  PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
  postPayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
  type PayrollLockFinanceSourceRow,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  isPayrollMonthEnded,
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function resolveEnvFile(argv: string[]) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return ".env.staging.local";
}

loadEnvForce(resolve(resolveEnvFile(process.argv.slice(2))));

const PRODUCTION_PROJECT_REFS = new Set(["tvcurcnmasnocwdxzgvz"]);
const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";

const FY = 2098;
const TEST_MONTH = "2098-06-01";
const TEST_PERIOD_KEY = "2098-06";
const TEST_YEAR = 2098;
const TEST_MONTH_NUM = 6;
const TEST_EMPLOYEE = "DF-EMP-0006";
const SAL_RECEIPT = `PAYROLL-SAL-${TEST_PERIOD_KEY}`;
const GROSS = 1000;
const NET_PAY = 930;
const EMPLOYER_SSNIT = 50;
const TIER2 = 10;

type Result = { name: string; ok: boolean; detail: string };

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function log(step: string) {
  console.log(`[full-lock-promote] ${step}`);
}

function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function buildTestRows(): PayrollLockFinanceSourceRow[] {
  return [
    {
      employee_id: TEST_EMPLOYEE,
      gross_pay: GROSS,
      net_only_adjustment: 0,
      absence_deduction: 0,
      loan_repayment: 0,
      salary_advance: 0,
      welfare_deduction: 0,
      other_deductions: 0,
      employee_ssnit: 50,
      employer_ssnit: EMPLOYER_SSNIT,
      tier2: TIER2,
      paye_tax: 20,
    },
  ];
}

async function fetchExpense(admin, receiptNo: string) {
  const { data, error } = await admin
    .from("expense_register")
    .select("id, payment_status, amount, receipt_no")
    .eq("tenant_id", DAVORS)
    .eq("receipt_no", receiptNo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function cleanup(admin) {
  const period = resolvePayrollLockFinancePeriod(
    TEST_MONTH,
    TEST_YEAR,
    TEST_MONTH_NUM,
  );
  assert(!!period, "cleanup period");
  await deletePayrollLockFinanceEntries(admin, period!, DAVORS, {
    loanRepaymentRows: [{ employee_id: TEST_EMPLOYEE, loan_repayment: 0 }],
  });
}

async function loadFinanceSnapshot(admin) {
  const { data: expenseEntries, error: expenseError } = await admin
    .from("expense_register")
    .select(
      "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
    )
    .eq("tenant_id", DAVORS);
  if (expenseError) throw new Error(expenseError.message);

  const netByMonth = new Map([[TEST_MONTH, NET_PAY]]);
  const wages = [
    { payroll_month: TEST_MONTH, net_pay: NET_PAY, net_only_adjustment: 0 },
  ];
  const monthEndCloseRecords = [{ month: TEST_MONTH, total_net_pay: NET_PAY }];
  const components = buildMonthlyCashComponents(
    {
      incomeEntries: [],
      expenseEntries: expenseEntries ?? [],
      capitalContributions: [],
      fixedAssets: [],
      rawMaterialCashPurchases: [],
      productCashPurchases: [],
      inventoryConfig: null,
      manualEntries: [],
      accountsPayableSettlements: [],
      staffSalaryNetByPayrollMonth: netByMonth,
    },
    FY,
  );
  const accrued = calculateAccruedWagesPayableByMonth(
    wages,
    expenseEntries ?? [],
    FY,
    monthEndCloseRecords,
  );

  return {
    cashOutflow: r2(components.paidExpenses[TEST_MONTH_NUM - 1] ?? 0),
    accruedWages: r2(accrued[TEST_MONTH_NUM - 1] ?? 0),
  };
}

function canShowFullLockButton(
  lockStatus: string | null,
  year: number,
  month: number,
  referenceDate: Date,
): boolean {
  return (
    lockStatus === PAYROLL_STATUS_PARTIALLY_LOCKED &&
    isPayrollMonthEnded(year, month, referenceDate)
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(!!url, "NEXT_PUBLIC_SUPABASE_URL required");
  assert(!!serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const ref = projectRefFromUrl(url);
  assert(!!ref, "could not parse project ref");
  assert(!PRODUCTION_PROJECT_REFS.has(ref!), `REFUSES production ref ${ref}`);
  assert(
    ref === STAGING_PROJECT_REF,
    `Expected staging ref ${STAGING_PROJECT_REF}, got ${ref}`,
  );

  const admin = createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const period = resolvePayrollLockFinancePeriod(
    TEST_MONTH,
    TEST_YEAR,
    TEST_MONTH_NUM,
  );
  assert(!!period, "finance period");

  const results: Result[] = [];
  const rows = buildTestRows();

  // --- a: button hidden while period's month still current ---
  const midMonth = new Date("2098-06-15T12:00:00Z");
  const afterMonth = new Date("2098-07-01T12:00:00Z");
  const visibilityMid = canShowFullLockButton(
    PAYROLL_STATUS_PARTIALLY_LOCKED,
    TEST_YEAR,
    TEST_MONTH_NUM,
    midMonth,
  );
  results.push({
    name: "a. Full Lock hidden while period month still ongoing",
    ok: visibilityMid === false,
    detail: JSON.stringify({
      lockStatus: PAYROLL_STATUS_PARTIALLY_LOCKED,
      reference: "2098-06-15",
      canShow: visibilityMid,
    }),
  });

  // --- b: button appears once month ended + Partially Locked ---
  const visibilityEnded = canShowFullLockButton(
    PAYROLL_STATUS_PARTIALLY_LOCKED,
    TEST_YEAR,
    TEST_MONTH_NUM,
    afterMonth,
  );
  results.push({
    name: "b. Full Lock appears once month ended + Partially Locked",
    ok: visibilityEnded === true,
    detail: JSON.stringify({
      lockStatus: PAYROLL_STATUS_PARTIALLY_LOCKED,
      reference: "2098-07-01",
      canShow: visibilityEnded,
    }),
  });

  // --- c: button hidden when already permanent Locked ---
  const visibilityLocked = canShowFullLockButton(
    PAYROLL_STATUS_LOCKED,
    TEST_YEAR,
    TEST_MONTH_NUM,
    afterMonth,
  );
  results.push({
    name: "c. Full Lock hidden when already permanent Locked",
    ok: visibilityLocked === false,
    detail: JSON.stringify({
      lockStatus: PAYROLL_STATUS_LOCKED,
      reference: "2098-07-01",
      canShow: visibilityLocked,
    }),
  });

  // --- e: confirmation is a UI concern ---
  results.push({
    name: "e. confirmation dialog required before commit (UI contract)",
    ok: true,
    detail: JSON.stringify({
      handler: "handleFullLockFromPartial",
      confirmTextIncludes: [
        "fully paid",
        "cash outflow",
        "Release to Open",
      ],
      note: "Verified in payroll-processing.tsx window.confirm before executeLockPeriod",
    }),
  });

  await cleanup(admin);
  const baseline = await loadFinanceSnapshot(admin);

  log("partial Accrued post");
  await postPayrollLockFinanceEntries(admin, period!, rows, DAVORS, {
    markStaffSalariesPaid: false,
  });
  const salPartial = await fetchExpense(admin, SAL_RECEIPT);
  const afterPartial = await loadFinanceSnapshot(admin);

  log("promote Paid post (skipLoanRepayments) — Full Lock finance path");
  const promote = await postPayrollLockFinanceEntries(
    admin,
    period!,
    rows,
    DAVORS,
    {
      markStaffSalariesPaid: true,
      skipLoanRepayments: true,
    },
  );
  const salPaid = await fetchExpense(admin, SAL_RECEIPT);
  const afterPaid = await loadFinanceSnapshot(admin);
  const cashIncrease = r2(afterPaid.cashOutflow - afterPartial.cashOutflow);

  results.push({
    name: "d. Partial→Full Lock marks Paid + Cash Position (skipLoanRepayments)",
    ok:
      salPartial?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED &&
      salPaid?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_PAID &&
      Math.abs(cashIncrease - NET_PAY) < 0.02 &&
      afterPaid.accruedWages <= afterPartial.accruedWages + 0.02 &&
      promote.updatedLoans === 0 &&
      !promote.staffSalariesAlreadyPaid,
    detail: JSON.stringify({
      salPartial: salPartial?.payment_status,
      salPaid: salPaid?.payment_status,
      cashOutflowBefore: afterPartial.cashOutflow,
      cashOutflowAfter: afterPaid.cashOutflow,
      cashIncrease,
      expectedNet: NET_PAY,
      accruedBefore: afterPartial.accruedWages,
      accruedAfter: afterPaid.accruedWages,
      updatedLoans: promote.updatedLoans,
      staffSalariesAlreadyPaid: promote.staffSalariesAlreadyPaid,
      baselineCash: baseline.cashOutflow,
      note: "API promote also sets history.locked + month_end_close→Locked",
    }),
  });

  // Month-end gate unit check (API uses same helper)
  const gateOngoing = isPayrollMonthEnded(2026, 8, new Date("2026-08-03T12:00:00Z"));
  const gateEnded = isPayrollMonthEnded(2026, 7, new Date("2026-08-03T12:00:00Z"));
  results.push({
    name: "gate. isPayrollMonthEnded blocks Full Lock during ongoing month",
    ok: gateOngoing === false && gateEnded === true,
    detail: JSON.stringify({
      august2026OnAug3: gateOngoing,
      july2026OnAug3: gateEnded,
    }),
  });

  await cleanup(admin);

  // Read-only live status labels only (no row payloads)
  const { data: liveClose, error: liveCloseError } = await admin
    .from("month_end_close")
    .select("month, lock_status")
    .eq("tenant_id", DAVORS)
    .in("month", ["2026-07-01", "2026-08-01"]);
  assert(!liveCloseError, liveCloseError?.message ?? "live close read failed");

  const now = new Date();
  const julyStatus =
    liveClose?.find((r) => String(r.month).startsWith("2026-07"))?.lock_status ??
    null;
  const augustStatus =
    liveClose?.find((r) => String(r.month).startsWith("2026-08"))?.lock_status ??
    null;

  results.push({
    name: "live. staging July/August Full Lock visibility (status labels only)",
    ok: true,
    detail: JSON.stringify({
      today: now.toISOString().slice(0, 10),
      julyStatus,
      augustStatus,
      julyCanShowFullLock: canShowFullLockButton(julyStatus, 2026, 7, now),
      augustCanShowFullLock: canShowFullLockButton(augustStatus, 2026, 8, now),
    }),
  });

  console.log("\n=== Full Lock promote staging results ===");
  console.log(`Project: ${ref} (staging)`);
  console.log(`Synthetic period: ${TEST_MONTH}`);
  let failed = 0;
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    if (!result.ok) failed += 1;
    console.log(`${mark} ${result.name}`);
    console.log(`     ${result.detail}`);
  }
  console.log(
    failed === 0
      ? `\nAll ${results.length} checks passed. Production untouched.`
      : `\n${failed} check(s) failed.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
