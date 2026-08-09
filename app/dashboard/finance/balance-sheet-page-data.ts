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
import { normalizePayrollMonthKey } from "./accrued-wages-utils";

import type {
  AccountsPayablePaymentRow,
  DirectorsLoanRepaymentRow,
} from "./directors-loan-utils";

/** Columns required for live open-month payroll recalc (display-only; never written back). */
export const PAYROLL_PROCESSING_SELECT =
  "id, payroll_month, status, employee_id, basic_salary, housing_allowance, transport_allowance, other_allowances, department, project_contract, daily_rate, days_to_pay, absence_deduction, overtime_amount, loan_repayment, bonuses, arrears, net_only_adjustment, salary_advance, welfare_deduction, other_deductions, gross_pay, employee_ssnit, employer_ssnit, tier2, paye_tax, total_deductions, net_pay";

export const MONTH_END_CLOSE_SELECT =
  "month, employees_recorded, total_net_pay, lock_status, notes";

export const MANUAL_FINANCIAL_ENTRY_SELECT =
  "period_month, cash_on_hand, bank_balance, prepayments_wht_receivable, inventory_consumables, accrued_expenses, withholding_tax_payable, vat_payable, bank_loans, other_long_term_liabilities, directors_loan, retained_earnings_prior_years, share_capital, purchase_of_fixed_assets, loan_proceeds, loan_repayments, opening_cash_balance, other_cash_inflows";

export const BALANCE_SHEET_INCOME_SELECT =
  "date, amount, amount_received, outstanding_balance, wht_amount, service_category, description, entry_type, sale_status, net_of_tax_amount, output_vat_amount, id, invoice_no, client_id, product_id, payment_status, client:customers!income_register_client_id_fkey(client_id, client_name), product:finished_products!product_id(product_code, product_name, unit_of_measure, standard_selling_price)";

export type BalanceSheetDateRange = {
  from: string;
  to: string;
};

export type FetchBalanceSheetPageDataOptions = {
  /** When omitted, defaults to prior-year Jan 1 through current FY Dec 31. Pass null for no filter. */
  dateRange?: BalanceSheetDateRange | null;
  /** When true, always load live-recalc bundle. When false, never. Default auto skips when all processing months are locked. */
  includePayrollLiveRecalc?: boolean | "auto";
  /** Optional dev counter — incremented once per Supabase HTTP request in this loader. */
  requestCounter?: { count: number };
};

export function getDefaultBalanceSheetDateRange(
  referenceDate = new Date(),
): BalanceSheetDateRange {
  const endYear = referenceDate.getFullYear();
  return {
    from: `${endYear - 1}-01-01`,
    to: `${endYear}-12-31`,
  };
}

export function payrollProcessingNeedsLiveRecalc(
  payrollHistory: Array<{ payroll_month: string }>,
  payrollProcessing: Array<{ payroll_month: string }>,
): boolean {
  const historyMonths = new Set(
    payrollHistory.map((entry) => normalizePayrollMonthKey(entry.payroll_month)),
  );

  return payrollProcessing.some(
    (row) =>
      !historyMonths.has(normalizePayrollMonthKey(row.payroll_month)),
  );
}

function tickRequestCounter(counter: { count: number } | undefined, n = 1): void {
  if (counter) {
    counter.count += n;
  }
}

function applyDateRangeFilter<T extends { gte: (col: string, val: string) => T; lte: (col: string, val: string) => T }>(
  query: T,
  column: string,
  dateRange: BalanceSheetDateRange,
): T {
  return query.gte(column, dateRange.from).lte(column, dateRange.to);
}

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
  options?: { requestCounter?: { count: number } },
): Promise<InventoryBalanceSheetInput> {
  const counter = options?.requestCounter;

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

  if (counter) {
    tickRequestCounter(counter, 6);
  }

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
  options: FetchBalanceSheetPageDataOptions = {},
): Promise<BalanceSheetPageData> {
  const dateRange =
    options.dateRange === undefined
      ? getDefaultBalanceSheetDateRange()
      : options.dateRange;
  const requestCounter = options.requestCounter;

  let incomeQuery = supabase
    .from("income_register")
    .select(BALANCE_SHEET_INCOME_SELECT)
    .eq("tenant_id", tenantId)
    .order("date", { ascending: true });
  let expenseQuery = supabase
    .from("expense_register")
    .select(
      "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
    )
    .eq("tenant_id", tenantId)
    .order("date", { ascending: true });
  let payrollHistoryQuery = supabase
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment, gross_pay")
    .eq("tenant_id", tenantId)
    .order("payroll_month", { ascending: true });
  let payrollProcessingQuery = supabase
    .from("payroll_processing")
    .select(PAYROLL_PROCESSING_SELECT)
    .eq("tenant_id", tenantId)
    .order("payroll_month", { ascending: true });

  if (dateRange) {
    incomeQuery = applyDateRangeFilter(incomeQuery, "date", dateRange);
    expenseQuery = applyDateRangeFilter(expenseQuery, "date", dateRange);
    payrollHistoryQuery = applyDateRangeFilter(
      payrollHistoryQuery,
      "payroll_month",
      dateRange,
    );
    payrollProcessingQuery = applyDateRangeFilter(
      payrollProcessingQuery,
      "payroll_month",
      dateRange,
    );
  }

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
  ] = await Promise.all([
    incomeQuery,
    expenseQuery,
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
      .select(MANUAL_FINANCIAL_ENTRY_SELECT)
      .eq("tenant_id", tenantId)
      .order("period_month", { ascending: true }),
    payrollHistoryQuery,
    payrollProcessingQuery,
    supabase
      .from("month_end_close")
      .select(MONTH_END_CLOSE_SELECT)
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
    fetchInventoryBalanceSheetInput(supabase, tenantId, { requestCounter }),
  ]);

  if (requestCounter) {
    tickRequestCounter(requestCounter, 12);
  }

  const payrollHistoryRows =
    (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [];
  const payrollProcessingRows =
    (payrollProcessing as PayrollProcessingRow[] | null) ?? [];

  const includeLiveRecalc =
    options.includePayrollLiveRecalc === false
      ? false
      : options.includePayrollLiveRecalc === true ||
        payrollProcessingNeedsLiveRecalc(
          payrollHistoryRows,
          payrollProcessingRows,
        );

  let livePayrollBundle: Awaited<ReturnType<typeof fetchPayrollLiveRecalcBundle>> =
    {
      employees: [],
      liveContext: {
        attendance: [],
        overtime: [],
        loans: [],
        taxConfigs: {
          ssnitRows: [],
          casualRows: [],
          payeBands: [],
        },
        compensationPolicyConfig: {
          salaryRates: [],
          allowanceTypes: [],
          compensationPolicies: [],
        },
      },
      error: null,
    };

  if (includeLiveRecalc) {
    livePayrollBundle = await fetchPayrollLiveRecalcBundle(supabase, {
      tenantId,
    });
    tickRequestCounter(requestCounter, 10);
  }

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
      payrollHistoryRows,
      payrollProcessingRows,
      livePayrollBundle.employees,
      livePayrollBundle.liveContext,
    ),
    initialMonthEndCloseNetPay:
      (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? [],
    initialMonthEndCloseRecords:
      (monthEndCloseRecords as MonthEndCloseRecord[] | null) ?? [],
    initialPayrollProcessingRows: payrollProcessingRows,
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
