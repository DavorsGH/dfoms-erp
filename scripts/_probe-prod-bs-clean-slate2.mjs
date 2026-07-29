import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

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
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const JUNE_ID = "8091b3ef-3f13-43c1-bbad-9bab3bdf493a";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function load() {
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
        "id, date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount, invoice_no",
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
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("tax_ledger_entries")
      .select(
        "id, entry_date, period_month, direction, tax_component, tax_amount, status, source_type, source_id, notes",
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

function build(inputs, { income, tax }) {
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
  return buildBalanceSheetReport(
    income,
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
    tax,
  );
}

const inputs = await load();
const liveIncome = inputs.incomeEntries;
const liveTax = inputs.taxLedgerEntries;

const juneStillThere = liveIncome.find((e) => e.id === JUNE_ID || e.invoice_no === "PAYROLL-DEDSAV-2026-06");
console.log("June DEDSAV still in DB?", !!juneStillThere, juneStillThere?.id);

const noDedsavIncome = liveIncome.filter(
  (e) => !String(e.invoice_no ?? "").includes("DEDSAV") && e.id !== JUNE_ID,
);
const noDedsavTax = liveTax.filter(
  (t) =>
    t.source_id !== JUNE_ID &&
    t.source_id !== "b60b70db-1179-4226-b86f-bbaefeed1fc5" &&
    !String(t.notes ?? "").includes("DEDSAV"),
);

const scenarios = [
  ["LIVE (as DB now)", liveIncome, liveTax],
  ["Income without DEDSAV, tax LIVE (orphaned tax if income deleted)", noDedsavIncome, liveTax],
  ["Income without DEDSAV, tax without DEDSAV (clean delete)", noDedsavIncome, noDedsavTax],
];

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

for (const [label, income, tax] of scenarios) {
  const report = build(inputs, { income, tax });
  const j = getBalanceCheckForPeriod(report, 5);
  const u = getBalanceCheckForPeriod(report, 6);
  const aw = report.rows.find((r) => r.key === "accrued-wages-payable");
  const ar = report.rows.find((r) => r.key === "accounts-receivable");
  const vat = report.rows.find((r) => r.key === "net-vat-payable");
  const re = report.rows.find((r) => r.key === "retained-earnings");
  console.log(`\n${label}`);
  console.log(
    `  June gap=${j.difference} July gap=${u.difference} | AW=${aw?.amounts[6]} AR=${ar?.amounts[6]} VATpay=${vat?.amounts[6]} RE=${re?.amounts[6]}`,
  );
}

const clean = build(inputs, { income: noDedsavIncome, tax: noDedsavTax });
const cleanPlusJuly = build(inputs, {
  income: [...noDedsavIncome, idealJuly],
  tax: noDedsavTax,
});
console.log("\nClean slate + ideal July DEDSAV only:");
console.log("  July:", getBalanceCheckForPeriod(cleanPlusJuly, 6));
console.log(
  "  residual after July absence fix:",
  r2(getBalanceCheckForPeriod(cleanPlusJuly, 6).difference),
);
console.log(
  "  clean July gap before July fix:",
  r2(getBalanceCheckForPeriod(clean, 6).difference),
);
console.log(
  "  clean July gap - 85.76:",
  r2(getBalanceCheckForPeriod(clean, 6).difference - 85.76),
);

// Re-confirm tax row still points at living/missing income
const { data: taxRow } = await admin
  .from("tax_ledger_entries")
  .select("*")
  .eq("id", "51539700-d73d-419d-b0ec-65dcb9766589")
  .maybeSingle();
const { data: incomeRow } = await admin
  .from("income_register")
  .select("id, invoice_no")
  .eq("id", JUNE_ID)
  .maybeSingle();
console.log("\nTax 51539700 still exists?", !!taxRow, "source_id=", taxRow?.source_id);
console.log("Income source still exists?", !!incomeRow, incomeRow);
