import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

function loadEnvFile(filePath: string) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const referenceDate = process.env.VERIFY_REFERENCE_DATE
    ? new Date(process.env.VERIFY_REFERENCE_DATE)
    : new Date();
  const financialYear = referenceDate.getFullYear();
  const monthIndex = referenceDate.getMonth();

  const [
    { data: incomeEntries },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: capitalContributions },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndCloseRecords },
    inventoryBalanceSheet,
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, service_category",
      ),
    supabase
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no",
      ),
    supabase
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      ),
    supabase
      .from("accounts_payable")
      .select("invoice_date, balance_due, amount, amount_paid"),
    supabase.from("capital_contributions").select("id, date, contributed_by, amount, description, notes"),
    supabase.from("payroll_history").select("payroll_month, net_pay"),
    supabase.from("payroll_processing").select("payroll_month, net_pay"),
    supabase.from("month_end_close").select("month, total_net_pay"),
    fetchInventoryBalanceSheetInput(supabase),
  ]);

  const cashFlowExpenseEntries =
    expenseEntries?.map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
    })) ?? [];

  const report = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlowExpenseEntries,
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    financialYear,
    {
      ...inventoryBalanceSheet,
      referenceDate,
    },
  );

  const balanceCheck = getBalanceCheckForPeriod(report, monthIndex);
  const inventoryRow = report.rows.find((row) => row.key === "inventory");
  const periodLabel = `${financialYear}-${String(monthIndex + 1).padStart(2, "0")}`;

  process.stdout.write(
    JSON.stringify({
      periodLabel,
      balanceCheck,
      inventoryAmount: inventoryRow?.amounts[monthIndex] ?? 0,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
