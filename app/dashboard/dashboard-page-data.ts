import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchBalanceSheetPageData,
  fetchInventoryBalanceSheetInput,
  type BalanceSheetPageData,
  type FetchBalanceSheetPageDataOptions,
} from "./finance/balance-sheet-page-data";
import {
  CRM_WEBHOOK_SALE_SELECT,
  mergeSalesLogEntries,
  normalizeProductSaleForLog,
  normalizeWebhookSale,
} from "./crm/sales/sales-utils";
import type { ProductSaleEntry } from "./crm/product-sales-utils";
import { toSalesAnalysisRows } from "./dashboard-sales-analysis-utils";
import type { SalesAnalysisRow } from "./dashboard-sales-analysis-utils";
import type { BudgetVsActualReportData } from "./dashboard-budget-status-utils";
import { fetchBudgetVsActualReportData } from "./reports/finance-report-data";
import type { BalanceSheetIncomeEntry } from "./finance/balance-sheet-utils";
import { fetchScopedEmployeeIds } from "./hr-payroll/payroll-bu-scope-utils";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchDashboardSharedRegisterRows } from "./dashboard-shared-register-fetch";

export type DashboardPageData = BalanceSheetPageData & {
  salesAnalysisEntries: SalesAnalysisRow[];
  budgetVsActualReportData: BudgetVsActualReportData;
  /** Supabase HTTP requests issued by this orchestrator (balance sheet loader + crm_sales). */
  supabaseRequestCount: number;
};

export type FetchDashboardPageDataOptions = FetchBalanceSheetPageDataOptions;

type IncomeEntryWithSalesRelations = BalanceSheetIncomeEntry & {
  id?: string;
  invoice_no?: string | null;
  client_id?: string | null;
  product_id?: string | null;
  payment_status?: string | null;
  client?: ProductSaleEntry["client"];
  product?: ProductSaleEntry["product"];
};

function incomeProductSaleToLogEntry(
  entry: IncomeEntryWithSalesRelations,
): ProductSaleEntry {
  return {
    id: entry.id ?? entry.date,
    date: entry.date,
    invoice_no: entry.invoice_no ?? "",
    client_id: entry.client_id ?? null,
    customer_name: null,
    amount: Number(entry.amount) || 0,
    amount_received: Number(entry.amount_received) || 0,
    outstanding_balance: entry.outstanding_balance ?? null,
    payment_status: entry.payment_status ?? "unpaid",
    due_date: entry.date,
    notes: null,
    product_id: entry.product_id ?? null,
    sale_quantity: null,
    unit_price: null,
    sale_status:
      entry.sale_status === "voided" ? "voided" : ("active" as const),
    voided_at: null,
    cogs_expense_id: null,
    cogs_reversal_expense_id: null,
    client: entry.client ?? null,
    product: entry.product ?? null,
  };
}

function buildSalesAnalysisFromIncomeAndCrm(
  incomeEntries: BalanceSheetIncomeEntry[],
  webhookSaleRows: Parameters<typeof normalizeWebhookSale>[0][] | null,
): SalesAnalysisRow[] {
  const productSales = incomeEntries
    .filter((entry) => entry.entry_type === "product_sale")
    .map((entry) =>
      normalizeProductSaleForLog(
        incomeProductSaleToLogEntry(entry as IncomeEntryWithSalesRelations),
      ),
    );

  const webhookSales = (webhookSaleRows ?? []).map((row) =>
    normalizeWebhookSale(row),
  );

  return toSalesAnalysisRows(mergeSalesLogEntries(productSales, webhookSales));
}

/**
 * Dashboard homepage loader: shared balance-sheet inputs (BS Check parity with
 * Finance → Balance Sheet) plus CRM webhook sales for Sales Analysis.
 * Product sales come from income_register rows already fetched by the shared loader.
 *
 * Owner /dashboard path dedupes register tables via {@link fetchDashboardSharedRegisterRows}
 * (explicit pass-through — not React cache() — so snapshot + page share one orchestrator).
 */
export async function fetchDashboardPageData(
  supabase: SupabaseClient,
  tenantId: string,
  options: FetchDashboardPageDataOptions = {},
): Promise<DashboardPageData> {
  const requestCounter = options.requestCounter ?? { count: 0 };
  const activeBusinessUnitId = options.activeBusinessUnitId ?? null;
  const viewAllBusinessUnits = options.viewAllBusinessUnits === true;
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const scopedEmployeesPromise = fetchScopedEmployeeIds(
    supabase,
    tenantId,
    buScope,
  );
  const webhookSalesPromise = supabase
    .from("crm_sales")
    .select(CRM_WEBHOOK_SALE_SELECT)
    .order("sale_date", { ascending: false });

  const scopedEmployees = await scopedEmployeesPromise;
  requestCounter.count += 1;

  const sharedRegisters = await fetchDashboardSharedRegisterRows(
    supabase,
    tenantId,
    buScope,
    scopedEmployees,
    requestCounter,
  );

  const inventoryPromise = fetchInventoryBalanceSheetInput(supabase, tenantId, {
    requestCounter,
    buScope,
    sharedRegisterFetch: sharedRegisters,
  });

  const [balanceSheetData, budgetVsActualReportData, webhookSalesResult] =
    await Promise.all([
      fetchBalanceSheetPageData(supabase, tenantId, {
        ...options,
        requestCounter,
        scopedEmployees,
        sharedRegisters,
        preloadedInventoryBalanceSheetPromise: inventoryPromise,
      }),
      fetchBudgetVsActualReportData(supabase, {
        tenantId,
        activeBusinessUnitId,
        viewAllBusinessUnits,
        buScope,
        scopedEmployees,
        sharedRegisters,
        requestCounter,
      }),
      webhookSalesPromise,
    ]);

  requestCounter.count += 1;

  const salesAnalysisEntries = buildSalesAnalysisFromIncomeAndCrm(
    balanceSheetData.initialIncomeEntries,
    webhookSalesResult.data as Parameters<typeof normalizeWebhookSale>[0][] | null,
  );

  return {
    ...balanceSheetData,
    salesAnalysisEntries,
    budgetVsActualReportData,
    supabaseRequestCount: requestCounter.count,
    fetchError:
      balanceSheetData.fetchError ??
      budgetVsActualReportData.fetchError ??
      webhookSalesResult.error?.message ??
      null,
  };
}
