import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAvailableYears } from "./finance-year-utils";
import type { CapitalContributionEntry } from "./capital-contributions-utils";
import type {
  CashFlowIncomeEntry,
  ManualFinancialEntry,
} from "./cash-flow-utils";
import {
  mergePayrollWagesSources,
  type BalanceSheetCashExpenseEntry,
  type MonthEndCloseNetPayEntry,
} from "./accrued-wages-utils";
import type {
  BalanceSheetAccountsPayableEntry,
  BalanceSheetIncomeEntry,
  InventoryBalanceSheetInput,
} from "./balance-sheet-utils";
import type {
  ProfitLossAssetEntry,
  ProfitLossExpenseEntry,
} from "./profit-loss-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
} from "../inventory/finished-products-utils";
import type { InventoryBalanceConfig } from "../inventory/inventory-balance-sheet-utils";
import {
  RAW_MATERIAL_SELECT,
  normalizeRawMaterial,
} from "../inventory/raw-materials-utils";

export type BalanceSheetPageData = {
  initialIncomeEntries: BalanceSheetIncomeEntry[];
  initialExpenseEntries: ProfitLossExpenseEntry[];
  initialFixedAssets: ProfitLossAssetEntry[];
  initialPayableEntries: BalanceSheetAccountsPayableEntry[];
  initialCapitalContributions: CapitalContributionEntry[];
  initialCashFlowIncomeEntries: CashFlowIncomeEntry[];
  initialCashFlowExpenseEntries: BalanceSheetCashExpenseEntry[];
  initialPayrollHistory: Array<{ payroll_month: string; net_pay: number }>;
  initialMonthEndCloseNetPay: MonthEndCloseNetPayEntry[];
  initialManualEntries: ManualFinancialEntry[];
  initialInventoryBalanceSheet: InventoryBalanceSheetInput;
  availableYears: number[];
  fetchError: string | null;
};

export async function fetchInventoryBalanceSheetInput(
  supabase: SupabaseClient,
): Promise<InventoryBalanceSheetInput> {
  const [
    { data: configRows },
    { data: rawMaterials },
    { data: finishedProducts },
    { data: batchSummaries },
    { data: cashPurchases },
  ] = await Promise.all([
    supabase
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("raw_materials")
      .select(RAW_MATERIAL_SELECT)
      .order("material_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    supabase
      .from("production_batches")
      .select("finished_product_id, total_batch_cost, quantity_produced"),
    supabase
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at"),
  ]);

  const config = configRows
    ? ({
        go_live_date: configRows.go_live_date,
        opening_inventory_value: Number(configRows.opening_inventory_value) || 0,
        created_at: configRows.created_at,
      } satisfies InventoryBalanceConfig)
    : null;

  return {
    config,
    rawMaterials: (rawMaterials ?? []).map((row) => normalizeRawMaterial(row)),
    finishedProducts: (finishedProducts ?? []).map((row) =>
      normalizeFinishedProduct(row),
    ),
    batchSummaries: batchSummaries ?? [],
    cashPurchases: cashPurchases ?? [],
  };
}

export async function fetchBalanceSheetPageData(
  supabase: SupabaseClient,
): Promise<BalanceSheetPageData> {
  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: payableEntries, error: payableError },
    { data: capitalContributions, error: capitalContributionsError },
    { data: manualEntries, error: manualError },
    { data: payrollHistory, error: payrollHistoryError },
    { data: payrollProcessing, error: payrollProcessingError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    inventoryBalanceSheet,
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, service_category, entry_type, sale_status",
      )
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no",
      )
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
    supabase
      .from("payroll_processing")
      .select("payroll_month, net_pay")
      .order("payroll_month", { ascending: true }),
    supabase
      .from("month_end_close")
      .select("month, total_net_pay")
      .order("month", { ascending: true }),
    fetchInventoryBalanceSheetInput(supabase),
  ]);

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
      receipt_no: entry.receipt_no ?? null,
    })) ?? [];

  return {
    initialIncomeEntries: incomeEntries ?? [],
    initialExpenseEntries: expenseEntries ?? [],
    initialFixedAssets: fixedAssets ?? [],
    initialPayableEntries: payableEntries ?? [],
    initialCapitalContributions:
      (capitalContributions as CapitalContributionEntry[] | null) ?? [],
    initialCashFlowIncomeEntries: cashFlowIncomeEntries,
    initialCashFlowExpenseEntries: cashFlowExpenseEntries,
    initialPayrollHistory: mergePayrollWagesSources(
      payrollHistory ?? [],
      payrollProcessing ?? [],
    ),
    initialMonthEndCloseNetPay:
      (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? [],
    initialManualEntries: manualEntries ?? [],
    initialInventoryBalanceSheet: inventoryBalanceSheet,
    availableYears: buildAvailableYears(
      (incomeEntries ?? []).map((entry) => entry.date),
      (expenseEntries ?? []).map((entry) => entry.date),
      [
        ...(capitalContributions ?? []).map((entry) => entry.date),
        ...(manualEntries ?? []).map((entry) => entry.period_month),
        ...(payableEntries ?? []).map((entry) => entry.invoice_date),
        ...(payrollHistory ?? []).map((entry) => entry.payroll_month),
      ],
    ),
    fetchError:
      incomeError?.message ??
      expenseError?.message ??
      fixedAssetsError?.message ??
      payableError?.message ??
      capitalContributionsError?.message ??
      manualError?.message ??
      payrollHistoryError?.message ??
      payrollProcessingError?.message ??
      monthEndCloseError?.message ??
      null,
  };
}
