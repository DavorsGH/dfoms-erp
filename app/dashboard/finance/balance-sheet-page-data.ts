import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAvailableYears } from "./finance-year-utils";
import type { CapitalContributionEntry } from "./capital-contributions-utils";
import type {
  CashFlowIncomeEntry,
  ManualFinancialEntry,
} from "./cash-flow-utils";
import {
  type BalanceSheetCashExpenseEntry,
  type MonthEndCloseNetPayEntry,
  type PayrollHistoryWagesEntry,
} from "./accrued-wages-utils";
import type {
  BalanceSheetAccountsPayableEntry,
  BalanceSheetIncomeEntry,
  BalanceSheetTaxLedgerEntry,
  InventoryBalanceSheetInput,
} from "./balance-sheet-utils";
import type { CashFlowInventoryPurchaseInput } from "./cash-flow-utils";
import type {
  ProfitLossAssetEntry,
  ProfitLossExpenseEntry,
} from "./profit-loss-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
} from "../inventory/finished-products-utils";
import type {
  FinishedProductAverageCostRow,
  InventoryBalanceConfig,
} from "../inventory/inventory-balance-sheet-utils";
import {
  RAW_MATERIAL_SELECT,
  normalizeRawMaterial,
} from "../inventory/raw-materials-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../hr-payroll/payroll-processing-utils";
import type { MonthEndCloseRecord } from "../hr-payroll/payroll-period-utils";

import type {
  AccountsPayablePaymentRow,
  DirectorsLoanRepaymentRow,
} from "./directors-loan-utils";

export type BalanceSheetPageData = {
  tenantId: string;
  initialIncomeEntries: BalanceSheetIncomeEntry[];
  initialExpenseEntries: ProfitLossExpenseEntry[];
  initialFixedAssets: ProfitLossAssetEntry[];
  initialPayableEntries: BalanceSheetAccountsPayableEntry[];
  initialAccountsPayablePayments: AccountsPayablePaymentRow[];
  initialDirectorsLoanRepayments: DirectorsLoanRepaymentRow[];
  initialCapitalContributions: CapitalContributionEntry[];
  initialCashFlowIncomeEntries: CashFlowIncomeEntry[];
  initialCashFlowExpenseEntries: BalanceSheetCashExpenseEntry[];
  initialPayrollHistory: PayrollHistoryWagesEntry[];
  initialMonthEndCloseNetPay: MonthEndCloseNetPayEntry[];
  initialManualEntries: ManualFinancialEntry[];
  initialInventoryBalanceSheet: InventoryBalanceSheetInput;
  initialTaxLedgerEntries: BalanceSheetTaxLedgerEntry[];
  /** Full month-end rows (Dashboard lock status / payroll widgets). */
  initialMonthEndCloseRecords: MonthEndCloseRecord[];
  /** Open-period payroll processing rows (Dashboard gross-pay trend). */
  initialPayrollProcessingRows: PayrollProcessingRow[];
  /** Stamped gross pay by month (Dashboard payroll cost trend). */
  initialPayrollHistoryGrossEntries: Array<{
    payroll_month: string;
    gross_pay: number;
  }>;
  availableYears: number[];
  fetchError: string | null;
};

export async function fetchInventoryBalanceSheetInput(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<InventoryBalanceSheetInput> {
  const [
    { data: configRows },
    { data: rawMaterials },
    { data: finishedProducts },
    { data: averageCostRows },
    { data: cashPurchases },
    { data: productCashPurchases },
  ] = await Promise.all([
    supabase
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("raw_materials")
      .select(RAW_MATERIAL_SELECT)
      .eq("tenant_id", tenantId)
      .order("material_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .order("product_name", { ascending: true }),
    // Combined production_batches + product_purchases weighted average cost
    // per finished product, computed server-side and scoped to this tenant.
    supabase.rpc("get_finished_product_average_costs", {
      p_tenant_id: tenantId,
    }),
    supabase
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", tenantId),
    supabase
      .from("product_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", tenantId),
  ]);

  const config = configRows
    ? ({
        go_live_date: configRows.go_live_date,
        opening_inventory_value: Number(configRows.opening_inventory_value) || 0,
        created_at: configRows.created_at,
      } satisfies InventoryBalanceConfig)
    : null;

  const normalizedFinishedProducts = (finishedProducts ?? []).map((row) =>
    normalizeFinishedProduct(row),
  );

  return {
    config,
    rawMaterials: (rawMaterials ?? []).map((row) => normalizeRawMaterial(row)),
    finishedProducts: normalizedFinishedProducts,
    finishedProductAverageCosts: (
      (averageCostRows as FinishedProductAverageCostRow[] | null) ?? []
    ).map((row) => ({
      product_id: row.product_id,
      average_cost: Number(row.average_cost) || 0,
    })),
    cashPurchases: cashPurchases ?? [],
    productCashPurchases: productCashPurchases ?? [],
  };
}

/**
 * Lean loader for the Cash Flow Statement: cash inventory purchases plus the
 * inventory go-live config, without the stock/valuation data the Balance
 * Sheet needs.
 */
export async function fetchCashFlowInventoryPurchaseInput(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CashFlowInventoryPurchaseInput> {
  const [
    { data: configRows },
    { data: rawMaterialPurchases },
    { data: productPurchases },
  ] = await Promise.all([
    supabase
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", tenantId),
    supabase
      .from("product_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", tenantId),
  ]);

  return {
    inventoryConfig: configRows
      ? ({
          go_live_date: configRows.go_live_date,
          opening_inventory_value:
            Number(configRows.opening_inventory_value) || 0,
          created_at: configRows.created_at,
        } satisfies InventoryBalanceConfig)
      : null,
    rawMaterialCashPurchases: rawMaterialPurchases ?? [],
    productCashPurchases: productPurchases ?? [],
  };
}

export async function fetchBalanceSheetPageData(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<BalanceSheetPageData> {
  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: payableEntries, error: payableError },
    { data: apPayments, error: apPaymentsError },
    { data: directorsLoanRepayments, error: directorsLoanRepaymentsError },
    { data: capitalContributions, error: capitalContributionsError },
    { data: manualEntries, error: manualError },
    { data: payrollHistory, error: payrollHistoryError },
    { data: payrollProcessing, error: payrollProcessingError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    { data: taxLedgerEntries, error: taxLedgerError },
    inventoryBalanceSheet,
    livePayrollBundle,
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, description, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true }),
    supabase
      .from("fixed_assets")
      .select(
        "tenant_id, original_cost, quantity, useful_life_years, purchase_date, depreciation_method, payment_method",
      )
      .eq("tenant_id", tenantId)
      .order("asset_id", { ascending: true }),
    supabase
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", tenantId)
      .order("invoice_date", { ascending: true }),
    supabase
      .from("accounts_payable_payments")
      .select("tenant_id, payment_date, amount, payment_source")
      .eq("tenant_id", tenantId)
      .order("payment_date", { ascending: true }),
    supabase
      .from("directors_loan_repayments")
      .select(
        "tenant_id, repayment_date, amount, applied_to_ap_component, applied_to_manual_component",
      )
      .eq("tenant_id", tenantId)
      .order("repayment_date", { ascending: true }),
    supabase
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true }),
    supabase
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("period_month", { ascending: true }),
    supabase
      .from("payroll_history")
      .select("payroll_month, net_pay, net_only_adjustment, gross_pay")
      .eq("tenant_id", tenantId)
      .order("payroll_month", { ascending: true }),
    // Full processing rows: open-month Accrued Wages live-recalc needs manuals.
    // Display-only — never written back from this report path.
    supabase
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("payroll_month", { ascending: true }),
    supabase
      .from("month_end_close")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("month", { ascending: false }),
    supabase
      .from("tax_ledger_entries")
      .select(
        "entry_date, period_month, direction, tax_component, tax_amount, status",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .order("entry_date", { ascending: true }),
    fetchInventoryBalanceSheetInput(supabase, tenantId),
    fetchPayrollLiveRecalcBundle(supabase, { tenantId }),
  ]);

  const cashFlowIncomeEntries =
    incomeEntries?.map((entry) => ({
      date: entry.date,
      amount_received: entry.amount_received,
      entry_type: entry.entry_type,
      sale_status: entry.sale_status,
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
      notes: entry.notes ?? null,
    })) ?? [];

  return {
    tenantId,
    initialIncomeEntries: incomeEntries ?? [],
    initialExpenseEntries: expenseEntries ?? [],
    initialFixedAssets: fixedAssets ?? [],
    initialPayableEntries: payableEntries ?? [],
    initialAccountsPayablePayments:
      (apPayments as AccountsPayablePaymentRow[] | null) ?? [],
    initialDirectorsLoanRepayments:
      (directorsLoanRepayments as DirectorsLoanRepaymentRow[] | null) ?? [],
    initialCapitalContributions:
      (capitalContributions as CapitalContributionEntry[] | null) ?? [],
    initialCashFlowIncomeEntries: cashFlowIncomeEntries,
    initialCashFlowExpenseEntries: cashFlowExpenseEntries,
    initialPayrollHistory: mergePayrollWagesWithLiveOpenMonths(
      (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
      (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
      livePayrollBundle.employees,
      livePayrollBundle.liveContext,
    ),
    initialMonthEndCloseNetPay:
      (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? [],
    initialMonthEndCloseRecords:
      (monthEndCloseRecords as MonthEndCloseRecord[] | null) ?? [],
    initialPayrollProcessingRows:
      (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    initialPayrollHistoryGrossEntries:
      (payrollHistory ?? []).map((entry) => ({
        payroll_month: entry.payroll_month,
        gross_pay: Number(entry.gross_pay) || 0,
      })),
    initialManualEntries: manualEntries ?? [],
    initialInventoryBalanceSheet: inventoryBalanceSheet,
    initialTaxLedgerEntries:
      (taxLedgerEntries as BalanceSheetTaxLedgerEntry[] | null) ?? [],
    availableYears: buildAvailableYears(
      (incomeEntries ?? []).map((entry) => entry.date),
      (expenseEntries ?? []).map((entry) => entry.date),
      [
        ...(capitalContributions ?? []).map((entry) => entry.date),
        ...(manualEntries ?? []).map((entry) => entry.period_month),
        ...(payableEntries ?? []).map((entry) => entry.invoice_date),
        ...(payrollHistory ?? []).map((entry) => entry.payroll_month),
        ...(taxLedgerEntries ?? []).map((entry) => entry.entry_date),
      ],
    ),
    fetchError:
      incomeError?.message ??
      expenseError?.message ??
      fixedAssetsError?.message ??
      payableError?.message ??
      apPaymentsError?.message ??
      directorsLoanRepaymentsError?.message ??
      capitalContributionsError?.message ??
      manualError?.message ??
      payrollHistoryError?.message ??
      payrollProcessingError?.message ??
      monthEndCloseError?.message ??
      taxLedgerError?.message ??
      livePayrollBundle.error ??
      null,
  };
}
