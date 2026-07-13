import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import Dashboard from "./dashboard";
import { buildDashboardViewModel } from "./dashboard-utils";
import type { CapitalContributionEntry } from "./finance/capital-contributions-utils";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: payableEntries, error: payableError },
    { data: capitalContributions, error: capitalContributionsError },
    { data: manualEntries, error: manualError },
    { data: payrollHistoryWages, error: payrollHistoryWagesError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    { data: payrollProcessingEntries, error: payrollProcessingError },
    { data: payrollHistoryEntries, error: payrollHistoryError },
    { data: payrollPayables, error: payrollPayablesError },
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
    supabase.from("month_end_close").select("*").order("month", { ascending: false }),
    supabase
      .from("payroll_processing")
      .select("payroll_month, gross_pay")
      .order("payroll_month", { ascending: true }),
    supabase
      .from("payroll_history")
      .select("payroll_month, gross_pay")
      .order("payroll_month", { ascending: true }),
    supabase
      .from("accounts_payable")
      .select("vendor_name, status, amount, invoice_date, description")
      .order("invoice_date", { ascending: false }),
  ]);

  const fetchError =
    incomeError?.message ??
    expenseError?.message ??
    fixedAssetsError?.message ??
    payableError?.message ??
    capitalContributionsError?.message ??
    manualError?.message ??
    payrollHistoryWagesError?.message ??
    monthEndCloseError?.message ??
    payrollProcessingError?.message ??
    payrollHistoryError?.message ??
    payrollPayablesError?.message ??
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

  const dashboardData = buildDashboardViewModel({
    incomeEntries:
      incomeEntries?.map((entry) => ({
        date: entry.date,
        amount: entry.amount,
      })) ?? [],
    profitLossIncomeEntries:
      incomeEntries?.map((entry) => ({
        date: entry.date,
        service_category: entry.service_category,
        amount: entry.amount,
      })) ?? [],
    balanceSheetIncomeEntries: incomeEntries ?? [],
    expenseEntries:
      expenseEntries?.map((entry) => ({
        date: entry.date,
        amount: entry.amount,
      })) ?? [],
    profitLossExpenseEntries:
      expenseEntries?.map((entry) => ({
        date: entry.date,
        expense_category: entry.expense_category,
        sub_category: entry.sub_category,
        amount: entry.amount,
      })) ?? [],
    fixedAssets: fixedAssets ?? [],
    payableEntries: payableEntries ?? [],
    capitalContributions:
      (capitalContributions as CapitalContributionEntry[] | null) ?? [],
    cashFlowIncomeEntries,
    cashFlowExpenseEntries,
    payrollHistoryWages: payrollHistoryWages ?? [],
    manualEntries: manualEntries ?? [],
    monthEndCloseRecords: monthEndCloseRecords ?? [],
    payrollProcessingEntries: payrollProcessingEntries ?? [],
    payrollHistoryEntries: payrollHistoryEntries ?? [],
    payrollPayables: payrollPayables ?? [],
  });

  return <Dashboard data={dashboardData} fetchError={fetchError} />;
}
