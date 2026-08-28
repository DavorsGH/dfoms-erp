import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchBalanceSheetPageData,
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
 */
export async function fetchDashboardPageData(
  supabase: SupabaseClient,
  tenantId: string,
  options: FetchDashboardPageDataOptions = {},
): Promise<DashboardPageData> {
  const requestCounter = options.requestCounter ?? { count: 0 };

  const [balanceSheetData, budgetVsActualReportData, { data: webhookSaleRows, error: webhookSaleError }] =
    await Promise.all([
      fetchBalanceSheetPageData(supabase, tenantId, {
        ...options,
        requestCounter,
      }),
      fetchBudgetVsActualReportData(supabase),
      supabase
        .from("crm_sales")
        .select(CRM_WEBHOOK_SALE_SELECT)
        .order("sale_date", { ascending: false }),
    ]);

  requestCounter.count += 1;

  const salesAnalysisEntries = buildSalesAnalysisFromIncomeAndCrm(
    balanceSheetData.initialIncomeEntries,
    webhookSaleRows as Parameters<typeof normalizeWebhookSale>[0][] | null,
  );

  return {
    ...balanceSheetData,
    salesAnalysisEntries,
    budgetVsActualReportData,
    supabaseRequestCount: requestCounter.count,
    fetchError:
      balanceSheetData.fetchError ??
      budgetVsActualReportData.fetchError ??
      webhookSaleError?.message ??
      null,
  };
}
