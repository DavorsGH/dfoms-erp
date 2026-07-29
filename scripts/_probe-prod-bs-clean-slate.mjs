import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  calculateAccruedWagesPayableByMonth,
  isAccruedStaffSalariesExpense,
  isStaffSalariesExpenseEntry,
  mergePayrollWagesSources,
  parseCashPaidFromExpenseNotes,
  parseWagesForfeitedFromExpenseNotes,
} from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildProfitLossReport,
  getTaxExclusiveExpenseAmount,
  getTaxExclusiveRevenueAmount,
} from "../app/dashboard/finance/profit-loss-utils";

function loadEnv(filePath) {
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

loadEnv(resolve(".env.local.backup"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error(`Not production: ${url}`);
}

const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const JUNE_DEDSAV_ID = "8091b3ef-3f13-43c1-bbad-9bab3bdf493a";
const JULY_DEDSAV_ID = "b60b70db-1179-4226-b86f-bbaefeed1fc5";

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function rowAmount(report, key, monthIndex) {
  const row = report.rows.find((r) => r.key === key);
  return row ? r2(row.amounts[monthIndex]) : null;
}

async function loadInputs() {
  const [
    { data: incomeEntries },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: capitalContributions },
    { data: manualEntries },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndCloseRecords },
    { data: taxLedgerEntries },
    inventoryBalanceSheet,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "id, date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount, invoice_no, description",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select(
        "payroll_month, net_pay, net_only_adjustment, gross_pay, absence_deduction, loan_repayment, salary_advance, welfare_deduction, other_deductions",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", TENANT),
    admin
      .from("tax_ledger_entries")
      .select(
        "id, entry_date, period_month, direction, tax_component, tax_amount, status, source_type, source_id, notes, counterparty_name, taxable_base, rate_pct, created_at, updated_at",
      )
      .eq("tenant_id", TENANT),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);

  return {
    incomeEntries: incomeEntries ?? [],
    expenseEntries: expenseEntries ?? [],
    fixedAssets: fixedAssets ?? [],
    payableEntries: payableEntries ?? [],
    capitalContributions: capitalContributions ?? [],
    manualEntries: manualEntries ?? [],
    payrollHistory: payrollHistory ?? [],
    payrollProcessing: payrollProcessing ?? [],
    monthEndCloseRecords: monthEndCloseRecords ?? [],
    taxLedgerEntries: taxLedgerEntries ?? [],
    inventoryBalanceSheet,
  };
}

function buildReport(inputs) {
  const cashFlow = inputs.expenseEntries.map((e) => ({
    date: e.date,
    expense_category: e.expense_category,
    sub_category: e.sub_category,
    amount: Number(e.amount) || 0,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  return {
    cashFlow,
    report: buildBalanceSheetReport(
      inputs.incomeEntries,
      inputs.expenseEntries,
      inputs.fixedAssets,
      inputs.payableEntries,
      inputs.capitalContributions,
      cashFlow,
      mergePayrollWagesSources(inputs.payrollHistory, inputs.payrollProcessing),
      inputs.monthEndCloseRecords,
      FY,
      inputs.inventoryBalanceSheet,
      inputs.manualEntries,
      inputs.taxLedgerEntries,
    ),
  };
}

const inputs = await loadInputs();
const { cashFlow, report } = buildReport(inputs);

console.log("=== DEDSAV income still present? ===");
const dedsav = inputs.incomeEntries.filter((e) =>
  String(e.invoice_no ?? "").includes("DEDSAV"),
);
console.log(dedsav.length ? dedsav : "NONE");

console.log("\n=== PAYROLL-SAL / ESSNIT rows ===");
for (const e of inputs.expenseEntries.filter((x) =>
  /^PAYROLL-(SAL|ESSNIT)-2026-0[67]/i.test(x.receipt_no ?? ""),
)) {
  const stub = {
    expense_category: e.expense_category,
    description: e.description,
    receipt_no: e.receipt_no,
    payment_status: e.payment_status,
    date: e.date,
    notes: e.notes,
    amount: e.amount,
  };
  console.log({
    receipt_no: e.receipt_no,
    amount: e.amount,
    category: e.expense_category,
    status: e.payment_status,
    notes: e.notes,
    isStaffSal: isStaffSalariesExpenseEntry(stub),
    isAccrued: isAccruedStaffSalariesExpense(stub),
    cashPaid: parseCashPaidFromExpenseNotes(e.notes),
    forfeited: parseWagesForfeitedFromExpenseNotes(e.notes),
  });
}

// History sums
for (const month of ["2026-06-01", "2026-07-01"]) {
  const rows = inputs.payrollHistory.filter(
    (r) => String(r.payroll_month).slice(0, 10) === month,
  );
  const sum = (f) => r2(rows.reduce((s, r) => s + (Number(r[f]) || 0), 0));
  console.log(`\n=== HISTORY ${month} n=${rows.length} ===`, {
    gross: sum("gross_pay"),
    net: sum("net_pay"),
    absence: sum("absence_deduction"),
    loan: sum("loan_repayment"),
    advance: sum("salary_advance"),
    welfare: sum("welfare_deduction"),
    other: sum("other_deductions"),
    orphan:
      sum("absence_deduction") +
      sum("loan_repayment") +
      sum("salary_advance") +
      sum("welfare_deduction") +
      sum("other_deductions"),
  });
}

const awByMonth = calculateAccruedWagesPayableByMonth(
  mergePayrollWagesSources(inputs.payrollHistory, inputs.payrollProcessing),
  cashFlow,
  FY,
  inputs.monthEndCloseRecords,
);

const juneCheck = getBalanceCheckForPeriod(report, 5);
const julyCheck = getBalanceCheckForPeriod(report, 6);
const fyCheck = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);

console.log("\n=== ENGINE BS CHECK ===");
console.log("June (idx5):", juneCheck);
console.log("July (idx6):", julyCheck);
console.log("FY:", fyCheck);

console.log("\n=== KEY BS LINE AMOUNTS ===");
for (const key of [
  "cash",
  "accounts-receivable",
  "wht-receivable",
  "net-vat-receivable",
  "accrued-wages-payable",
  "accounts-payable",
  "wht-payable",
  "net-vat-payable",
  "paye-payable",
  "ssnit-payable",
  "share-capital",
  "retained-earnings",
]) {
  console.log(
    `${key}: jun=${rowAmount(report, key, 5)} jul=${rowAmount(report, key, 6)}`,
  );
}

console.log("\n=== Accrued wages month array ===");
console.log(
  awByMonth
    .map((v, i) => (i < 12 ? `${i + 1}:${r2(v)}` : `FY:${r2(v)}`))
    .join(" "),
);

// June / July AW contributions explained
const juneNet = r2(
  inputs.payrollHistory
    .filter((r) => String(r.payroll_month).slice(0, 10) === "2026-06-01")
    .reduce((s, r) => s + (Number(r.net_pay) || 0), 0),
);
const julyNet = r2(
  inputs.payrollHistory
    .filter((r) => String(r.payroll_month).slice(0, 10) === "2026-07-01")
    .reduce((s, r) => s + (Number(r.net_pay) || 0), 0),
);
const juneSal = inputs.expenseEntries.find(
  (e) => e.receipt_no === "PAYROLL-SAL-2026-06",
);
const julySal = inputs.expenseEntries.find(
  (e) => e.receipt_no === "PAYROLL-SAL-2026-07",
);
const juneCash = parseCashPaidFromExpenseNotes(juneSal?.notes ?? null);
const juneForfeit = parseWagesForfeitedFromExpenseNotes(juneSal?.notes ?? null);
const juneShortfall =
  juneCash == null ? null : r2(juneNet - juneCash - (juneForfeit || 0));

console.log("\n=== PAYROLL / AW DECOMPOSITION ===");
console.log({
  juneStaffSalariesExpense: Number(juneSal?.amount) || 0,
  juneSalStatus: juneSal?.payment_status,
  juneNet,
  juneCashPaid: juneCash,
  juneForfeited: juneForfeit,
  juneAwContribution_shortfallOnly: juneShortfall,
  julyStaffSalariesExpense: Number(julySal?.amount) || 0,
  julySalStatus: julySal?.payment_status,
  julySalCategory: julySal?.expense_category,
  julyNet,
  julyAwContribution_fullNetIfAccrued: julyNet,
  julyAwAsOfEngine: r2(awByMonth[6]),
  juneAwAsOfEngine: r2(awByMonth[5]),
  explainedJulyAw: r2((juneShortfall || 0) + julyNet),
});

// Orphan tax ledger
console.log("\n=== ORPHAN TAX LEDGER (DEDSAV ids / invoice notes) ===");
const orphanTax = inputs.taxLedgerEntries.filter((t) => {
  const sid = String(t.source_id ?? "");
  const notes = String(t.notes ?? "");
  return (
    sid === JUNE_DEDSAV_ID ||
    sid === JULY_DEDSAV_ID ||
    notes.includes("PAYROLL-DEDSAV") ||
    notes.includes("DEDSAV")
  );
});
console.log(
  orphanTax.length
    ? JSON.stringify(orphanTax, null, 2)
    : "NONE matching DEDSAV ids/notes",
);

// Also: any tax legs whose source_id is missing from income_register
const incomeIds = new Set(inputs.incomeEntries.map((e) => e.id));
const danglingIncomeTax = inputs.taxLedgerEntries.filter(
  (t) =>
    t.source_type === "income_register" &&
    t.source_id &&
    !incomeIds.has(t.source_id),
);
console.log(
  `\n=== ALL dangling income_register tax legs (source missing) n=${danglingIncomeTax.length} ===`,
);
console.log(
  danglingIncomeTax.length
    ? JSON.stringify(danglingIncomeTax, null, 2)
    : "NONE",
);

// Simulate adding ideal July DEDSAV only
const idealJuly = {
  date: "2026-07-31",
  amount: 85.76,
  amount_received: 0,
  outstanding_balance: 0,
  wht_amount: 0,
  service_category: "Other Income",
  entry_type: "service",
  sale_status: "active",
  net_of_tax_amount: 85.76,
  output_vat_amount: 0,
  invoice_no: "PAYROLL-DEDSAV-2026-07",
};
const withJuly = buildBalanceSheetReport(
  [...inputs.incomeEntries, idealJuly],
  inputs.expenseEntries,
  inputs.fixedAssets,
  inputs.payableEntries,
  inputs.capitalContributions,
  cashFlow,
  mergePayrollWagesSources(inputs.payrollHistory, inputs.payrollProcessing),
  inputs.monthEndCloseRecords,
  FY,
  inputs.inventoryBalanceSheet,
  inputs.manualEntries,
  inputs.taxLedgerEntries,
);
console.log("\n=== COUNTERFACTUAL: + ideal July DEDSAV only ===");
console.log("July check:", getBalanceCheckForPeriod(withJuly, 6));
console.log(
  "July gap delta vs current:",
  r2(getBalanceCheckForPeriod(withJuly, 6).difference - julyCheck.difference),
);

// P&L July staff salaries recognition
const pl = buildProfitLossReport(
  inputs.incomeEntries,
  inputs.expenseEntries,
  inputs.fixedAssets,
  FY,
);
const plInterest = pl.rows.filter((r) =>
  /Staff Salari|Other Income|Commercial Cleaning|Employer SSNIT|Finance/i.test(
    r.label,
  ),
);
console.log("\n=== P&L rows (jun/jul) ===");
for (const r of plInterest) {
  console.log(`  ${r.label}: jun=${r2(r.amounts[5])} jul=${r2(r.amounts[6])}`);
}

console.log("\n=== GAP vs JULY ABSENCE ===");
console.log({
  julyEngineGap: julyCheck.difference,
  julyAbsence: 85.76,
  gapMinusAbsence: r2(julyCheck.difference - 85.76),
  absGap: Math.abs(julyCheck.difference),
  absGapMinusAbsence: r2(Math.abs(julyCheck.difference) - 85.76),
});
