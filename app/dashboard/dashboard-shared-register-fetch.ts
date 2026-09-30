import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { BalanceSheetDateRange } from "./finance/balance-sheet-page-data";
import {
  PAYROLL_PROCESSING_SELECT,
} from "./finance/balance-sheet-page-data";
import { EXPENSE_REGISTER_PROFIT_LOSS_SELECT } from "./finance/customer-refund-expense-utils";
import {
  applyEmployeeIdScope,
  type ScopedEmployeeIdsResult,
} from "./hr-payroll/payroll-bu-scope-utils";
import type { PayrollProcessingRow } from "./hr-payroll/payroll-processing-utils";
import type { PayrollHistoryWagesEntry } from "./finance/accrued-wages-utils";
import type { ProfitLossExpenseEntry } from "./finance/profit-loss-utils";
import type {
  BudgetActualExpenseEntry,
  BudgetActualInventoryPurchaseEntry,
  BudgetActualPayrollRow,
} from "./reports/budget-vs-actual-utils";

/** One HTTP fetch per table shared by balance-sheet + budget loaders on owner /dashboard. */
export const DASHBOARD_SHARED_PAYROLL_HISTORY_SELECT =
  "payroll_month, net_pay, net_only_adjustment, gross_pay, project_contract";

export const DASHBOARD_SHARED_EXPENSE_REGISTER_SELECT =
  `${EXPENSE_REGISTER_PROFIT_LOSS_SELECT}, payment_status, description, receipt_no, notes, project_id`;

export const DASHBOARD_SHARED_RAW_MATERIAL_PURCHASES_SELECT =
  "purchase_date, total_cost, project_id, payment_method, created_at";

export const DASHBOARD_SHARED_PRODUCT_PURCHASES_SELECT =
  "purchase_date, total_cost, project_id, payment_method, created_at";

export type DashboardSharedPayrollHistoryRow = PayrollHistoryWagesEntry & {
  gross_pay?: number | string | null;
  project_contract?: string | null;
};

export type DashboardSharedExpenseRegisterRow = ProfitLossExpenseEntry & {
  payment_status?: string | null;
  description?: string | null;
  receipt_no?: string | null;
  notes?: string | null;
  project_id?: string | null;
};

export type DashboardSharedPurchaseRow = {
  purchase_date: string;
  total_cost: number | string;
  project_id?: string | null;
  payment_method?: string | null;
  created_at?: string | null;
};

export type DashboardSharedRegisterFetch = {
  payrollHistoryRows: DashboardSharedPayrollHistoryRow[];
  payrollProcessingRows: PayrollProcessingRow[];
  expenseRegisterRows: DashboardSharedExpenseRegisterRow[];
  rawMaterialPurchaseRows: DashboardSharedPurchaseRow[];
  productPurchaseRows: DashboardSharedPurchaseRow[];
  fetchError: string | null;
};

/**
 * Replicates PostgREST `.gte(col, from).lte(col, to)` on ISO date / month strings
 * (same lexicographic rules PostgreSQL uses for date/text comparisons in our loaders).
 */
export function filterRowsByInclusiveDateRange<
  T extends Record<string, unknown>,
>(rows: T[], column: keyof T, dateRange: BalanceSheetDateRange): T[] {
  return rows.filter((row) => {
    const value = String(row[column] ?? "");
    return value >= dateRange.from && value <= dateRange.to;
  });
}

export async function fetchDashboardSharedRegisterRows(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
  scopedEmployees: ScopedEmployeeIdsResult,
  requestCounter?: { count: number },
): Promise<DashboardSharedRegisterFetch> {
  const [
    { data: payrollHistory, error: payrollHistoryError },
    { data: payrollProcessing, error: payrollProcessingError },
    { data: expenseEntries, error: expenseError },
    { data: rawMaterialPurchases, error: rawMaterialPurchasesError },
    { data: productPurchases, error: productPurchasesError },
  ] = await Promise.all([
    applyEmployeeIdScope(
      supabase
        .from("payroll_history")
        .select(DASHBOARD_SHARED_PAYROLL_HISTORY_SELECT)
        .eq("tenant_id", tenantId),
      scopedEmployees.employeeIds,
    ).order("payroll_month", { ascending: true }),
    applyEmployeeIdScope(
      supabase
        .from("payroll_processing")
        .select(PAYROLL_PROCESSING_SELECT)
        .eq("tenant_id", tenantId),
      scopedEmployees.employeeIds,
    ).order("payroll_month", { ascending: true }),
    applyBusinessUnitScope(
      supabase
        .from("expense_register")
        .select(DASHBOARD_SHARED_EXPENSE_REGISTER_SELECT)
        .eq("tenant_id", tenantId),
      buScope,
    ).order("date", { ascending: true }),
    applyBusinessUnitScope(
      supabase
        .from("raw_material_purchases")
        .select(DASHBOARD_SHARED_RAW_MATERIAL_PURCHASES_SELECT)
        .eq("tenant_id", tenantId),
      buScope,
    ).order("purchase_date", { ascending: true }),
    applyBusinessUnitScope(
      supabase
        .from("product_purchases")
        .select(DASHBOARD_SHARED_PRODUCT_PURCHASES_SELECT)
        .eq("tenant_id", tenantId),
      buScope,
    ).order("purchase_date", { ascending: true }),
  ]);

  if (requestCounter) {
    requestCounter.count += 5;
  }

  return {
    payrollHistoryRows:
      (payrollHistory as DashboardSharedPayrollHistoryRow[] | null) ?? [],
    payrollProcessingRows:
      (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    expenseRegisterRows:
      (expenseEntries as DashboardSharedExpenseRegisterRow[] | null) ?? [],
    rawMaterialPurchaseRows: rawMaterialPurchases ?? [],
    productPurchaseRows: productPurchases ?? [],
    fetchError:
      scopedEmployees.error ??
      payrollHistoryError?.message ??
      payrollProcessingError?.message ??
      expenseError?.message ??
      rawMaterialPurchasesError?.message ??
      productPurchasesError?.message ??
      null,
  };
}

export function sliceSharedExpenseRowsForBalanceSheet(
  rows: DashboardSharedExpenseRegisterRow[],
  dateRange: BalanceSheetDateRange | null | undefined,
): DashboardSharedExpenseRegisterRow[] {
  if (!dateRange) {
    return rows;
  }
  return filterRowsByInclusiveDateRange(rows, "date", dateRange);
}

export function sliceSharedPayrollHistoryForBalanceSheet(
  rows: DashboardSharedPayrollHistoryRow[],
  dateRange: BalanceSheetDateRange | null | undefined,
): DashboardSharedPayrollHistoryRow[] {
  if (!dateRange) {
    return rows;
  }
  return filterRowsByInclusiveDateRange(rows, "payroll_month", dateRange);
}

export function sliceSharedPayrollProcessingForBalanceSheet(
  rows: PayrollProcessingRow[],
  dateRange: BalanceSheetDateRange | null | undefined,
): PayrollProcessingRow[] {
  if (!dateRange) {
    return rows;
  }
  return filterRowsByInclusiveDateRange(rows, "payroll_month", dateRange);
}

export function mapSharedExpensesForBudget(
  rows: DashboardSharedExpenseRegisterRow[],
): BudgetActualExpenseEntry[] {
  return rows.map((entry) => ({
    date: entry.date,
    expense_category: entry.expense_category,
    sub_category: entry.sub_category,
    amount: entry.amount,
    project_id: entry.project_id ?? null,
    is_customer_refund: entry.is_customer_refund ?? false,
  }));
}

export function mapSharedRawMaterialPurchasesForBudget(
  rows: DashboardSharedPurchaseRow[],
): BudgetActualInventoryPurchaseEntry[] {
  return rows.map((row) => ({
    purchase_date: row.purchase_date,
    total_cost: Number(row.total_cost) || 0,
    project_id: row.project_id ?? null,
  }));
}

export function mapSharedProductPurchasesForBudget(
  rows: DashboardSharedPurchaseRow[],
): BudgetActualInventoryPurchaseEntry[] {
  return rows.map((row) => ({
    purchase_date: row.purchase_date,
    total_cost: Number(row.total_cost) || 0,
    project_id: row.project_id ?? null,
  }));
}

export function mapSharedPayrollRowsForBudget(
  payrollHistory: DashboardSharedPayrollHistoryRow[],
  payrollProcessing: PayrollProcessingRow[],
): BudgetActualPayrollRow[] {
  return [
    ...payrollHistory.map((row) => ({
      payroll_month: row.payroll_month,
      gross_pay: Number(row.gross_pay) || 0,
      project_contract: row.project_contract ?? null,
    })),
    ...payrollProcessing.map((row) => ({
      payroll_month: row.payroll_month,
      gross_pay: Number(row.gross_pay) || 0,
      project_contract: row.project_contract ?? null,
    })),
  ];
}

/** Cash-flow inventory legs — same column subset as the former dedicated BS queries. */
export function mapSharedRawMaterialPurchasesForInventoryCash(
  rows: DashboardSharedRegisterFetch["rawMaterialPurchaseRows"],
) {
  return rows.map((row) => ({
    purchase_date: row.purchase_date,
    total_cost: row.total_cost,
    payment_method: row.payment_method,
    created_at: row.created_at,
  }));
}

export function mapSharedProductPurchasesForInventoryCash(
  rows: DashboardSharedRegisterFetch["productPurchaseRows"],
) {
  return rows.map((row) => ({
    purchase_date: row.purchase_date,
    total_cost: row.total_cost,
    payment_method: row.payment_method,
    created_at: row.created_at,
  }));
}
