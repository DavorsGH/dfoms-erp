import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { buildAvailableYears } from "../finance-year-utils";
import BalanceSheet from "../balance-sheet";
import BalanceSheetShell from "../balance-sheet-shell";
import type { CapitalContributionEntry } from "../capital-contributions-utils";

export default async function BalanceSheetPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: payableEntries, error: payableError },
    { data: capitalContributions, error: capitalContributionsError },
    { data: manualEntries, error: manualError },
    { data: payrollHistory, error: payrollHistoryError },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select("date, amount, amount_received, outstanding_balance, service_category")
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select("date, expense_category, sub_category, amount, payment_status, description")
      .order("date", { ascending: true }),
    supabase
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .order("asset_id", { ascending: true }),
    supabase
      .from("accounts_payable")
      .select("invoice_date, balance_due, amount, amount_paid")
      .order("invoice_date", { ascending: true }),
    supabase
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .order("date", { ascending: true }),
    supabase
      .from("manual_financial_entries")
      .select("*")
      .order("period_month", { ascending: true }),
    supabase
      .from("payroll_history")
      .select("payroll_month, net_pay")
      .order("payroll_month", { ascending: true }),
  ]);

  const fetchError =
    incomeError?.message ??
    expenseError?.message ??
    fixedAssetsError?.message ??
    payableError?.message ??
    capitalContributionsError?.message ??
    manualError?.message ??
    payrollHistoryError?.message ??
    null;

  const cashFlowIncomeEntries =
    incomeEntries?.map((entry) => ({
      date: entry.date,
      amount_received: entry.amount_received,
    })) ?? [];

  const cashFlowExpenseEntries =
    expenseEntries?.map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
    })) ?? [];

  const availableYears = buildAvailableYears(
    (incomeEntries ?? []).map((entry) => entry.date),
    (expenseEntries ?? []).map((entry) => entry.date),
    [
      ...(capitalContributions ?? []).map((entry) => entry.date),
      ...(manualEntries ?? []).map((entry) => entry.period_month),
      ...(payableEntries ?? []).map((entry) => entry.invoice_date),
      ...(payrollHistory ?? []).map((entry) => entry.payroll_month),
    ],
  );

  return (
    <BalanceSheetShell>
      <BalanceSheet
        initialIncomeEntries={incomeEntries ?? []}
        initialExpenseEntries={expenseEntries ?? []}
        initialFixedAssets={fixedAssets ?? []}
        initialPayableEntries={payableEntries ?? []}
        initialCapitalContributions={
          (capitalContributions as CapitalContributionEntry[] | null) ?? []
        }
        initialCashFlowIncomeEntries={cashFlowIncomeEntries}
        initialCashFlowExpenseEntries={cashFlowExpenseEntries}
        initialPayrollHistory={payrollHistory ?? []}
        initialManualEntries={manualEntries ?? []}
        availableYears={availableYears}
        fetchError={fetchError}
      />
    </BalanceSheetShell>
  );
}
