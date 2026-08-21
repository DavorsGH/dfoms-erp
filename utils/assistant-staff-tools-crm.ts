import "server-only";

import {
  buildTopSalesAnalysis,
  toSalesAnalysisRows,
} from "@/app/dashboard/dashboard-sales-analysis-utils";
import type { ProductSaleEntry } from "@/app/dashboard/crm/product-sales-utils";
import { normalizeProductSaleForLog } from "@/app/dashboard/crm/sales/sales-utils";
import type { ProductSaleReportRecord } from "@/app/dashboard/reports/inventory-reports-utils";
import { SALES_OPPORTUNITY_SELECT } from "@/app/dashboard/crm/sales-pipeline/sales-pipeline-utils";
import { fetchProductSalesReportData } from "@/app/dashboard/reports/inventory-report-data";
import {
  canAccessCrmSection,
  canAccessPosSection,
} from "@/utils/rbac-access";
import {
  CLIENT_QUOTATION_LIST_SELECT,
  normalizeClientQuotationListRow,
  type ClientQuotationListRow,
} from "@/utils/client-quotations-types";
import {
  COMMISSION_CALCULATION_LIST_SELECT,
  normalizeCommissionCalculationRow,
  type CommissionCalculationRow,
} from "@/utils/commission-types";
import {
  SALES_QUOTE_LIST_SELECT,
  normalizeSalesQuoteListRow,
  type SalesQuoteListRow,
} from "@/utils/sales-quotes-types";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  TOP_CUSTOMERS_LIMIT,
  getStaffSupabase,
  loadStaffDashboardViewModel,
  parseFinancialPeriod,
  periodKeyForSelection,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";

function hasSalesModuleAccess(role: import("@/app/dashboard/user-account-types").AppRole): boolean {
  return canAccessCrmSection(role) || canAccessPosSection(role);
}

function productSaleReportToProductSaleEntry(
  sale: ProductSaleReportRecord,
): ProductSaleEntry {
  return {
    id: sale.id,
    date: sale.date,
    invoice_no: sale.invoice_no,
    client_id: sale.client_id,
    customer_name: sale.customer_name,
    amount: Number(sale.amount) || 0,
    amount_received: 0,
    outstanding_balance: null,
    payment_status: "",
    due_date: sale.date,
    notes: null,
    product_id: sale.product_id,
    sale_quantity: sale.sale_quantity,
    unit_price: sale.unit_price,
    sale_status: sale.sale_status ?? "active",
    voided_at: null,
    cogs_expense_id: sale.cogs_expense_id ?? null,
    cogs_reversal_expense_id: null,
    client: sale.client ?? null,
    product: sale.product
      ? {
          ...sale.product,
          standard_selling_price: null,
        }
      : null,
  };
}

export async function getSalesSummary(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!hasSalesModuleAccess(sessionResult.session.role)) {
    return { error: "You do not have access to sales summary data." };
  }

  const period = parseFinancialPeriod(toolInput);
  const { mode, key } = periodKeyForSelection(period);

  if (canAccessCrmSection(sessionResult.session.role)) {
    const dashboardResult = await loadStaffDashboardViewModel();
    if ("error" in dashboardResult) {
      return dashboardResult;
    }

    const productSales = buildTopSalesAnalysis(
      dashboardResult.viewModel.salesAnalysisEntries,
      mode,
      key,
      "product",
    );
    const totalSales = productSales.reduce((sum, row) => sum + row.amount, 0);

    return {
      period,
      periodLabel: key,
      totalSalesGhs: Math.round(totalSales * 100) / 100,
      topProducts: productSales.slice(0, TOP_CUSTOMERS_LIMIT),
      fetchWarning: dashboardResult.fetchError,
    };
  }

  try {
    const supabase = await getStaffSupabase();
    const data = await fetchProductSalesReportData(supabase);
    const rows = toSalesAnalysisRows(
      (data.initialSales ?? [])
        .map(productSaleReportToProductSaleEntry)
        .map(normalizeProductSaleForLog),
    );
    const ranked = buildTopSalesAnalysis(rows, mode, key, "product");
    const totalSales = ranked.reduce((sum, row) => sum + row.amount, 0);

    return {
      period,
      periodLabel: key,
      totalSalesGhs: Math.round(totalSales * 100) / 100,
      topProducts: ranked.slice(0, TOP_CUSTOMERS_LIMIT),
      fetchWarning: data.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_sales_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getTopCustomers(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessCrmSection(sessionResult.session.role)) {
    return { error: "You do not have access to customer revenue data." };
  }

  const dashboardResult = await loadStaffDashboardViewModel();
  if ("error" in dashboardResult) {
    return dashboardResult;
  }

  const period = parseFinancialPeriod(toolInput);
  const { mode, key } = periodKeyForSelection(period);
  const customers = buildTopSalesAnalysis(
    dashboardResult.viewModel.salesAnalysisEntries,
    mode,
    key,
    "customer",
  ).slice(0, TOP_CUSTOMERS_LIMIT);

  return {
    period,
    periodLabel: key,
    customers,
    fetchWarning: dashboardResult.fetchError,
  };
}

export async function getSalesPipelineSummary(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessCrmSection(sessionResult.session.role)) {
    return { error: "You do not have access to sales pipeline data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select(SALES_OPPORTUNITY_SELECT);

    if (error) {
      console.error(
        "[assistant] get_sales_pipeline_summary failed:",
        error.message,
      );
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const openRows = (data ?? []).filter(
      (row) => row.stage !== "won" && row.stage !== "lost" && !row.closed_at,
    );

    const openStages = new Map<string, { count: number; estimatedValueGhs: number }>();
    for (const row of openRows) {
      const stage = String(row.stage ?? "new");
      const current = openStages.get(stage) ?? { count: 0, estimatedValueGhs: 0 };
      current.count += 1;
      current.estimatedValueGhs += Number(row.estimated_value) || 0;
      openStages.set(stage, current);
    }

    return {
      totalOpenOpportunities: openRows.length,
      byStage: [...openStages.entries()].map(([stage, stats]) => ({
        stage,
        count: stats.count,
        estimatedValueGhs: Math.round(stats.estimatedValueGhs * 100) / 100,
      })),
    };
  } catch (error) {
    console.error("[assistant] get_sales_pipeline_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getQuotesAndQuotationsStatus(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!hasSalesModuleAccess(sessionResult.session.role)) {
    return { error: "You do not have access to quotes and quotations data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const openQuoteStatuses = ["draft", "sent"];
    const openQuotationStatuses = ["draft", "sent"];

    const queries = [];
    if (canAccessCrmSection(sessionResult.session.role)) {
      queries.push(
        supabase
          .from("client_quotations")
          .select(CLIENT_QUOTATION_LIST_SELECT)
          .in("status", openQuotationStatuses)
          .order("issue_date", { ascending: false })
          .limit(LIST_LIMIT),
      );
    }
    if (canAccessCrmSection(sessionResult.session.role) || canAccessPosSection(sessionResult.session.role)) {
      queries.push(
        supabase
          .from("sales_quotes")
          .select(SALES_QUOTE_LIST_SELECT)
          .in("status", openQuoteStatuses)
          .order("quote_date", { ascending: false })
          .limit(LIST_LIMIT),
      );
    }

    const results = await Promise.all(queries);
    const clientQuotations: Array<Record<string, unknown>> = [];
    const productQuotes: Array<Record<string, unknown>> = [];

    for (const result of results) {
      if (result.error) {
        console.error(
          "[assistant] get_quotes_and_quotations_status failed:",
          result.error.message,
        );
        return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
      }
    }

    let resultIndex = 0;
    if (canAccessCrmSection(sessionResult.session.role)) {
      const rows = ((results[resultIndex]?.data as ClientQuotationListRow[] | null) ?? [])
        .map(normalizeClientQuotationListRow)
        .slice(0, LIST_LIMIT);
      for (const row of rows) {
        const client = Array.isArray(row.client) ? row.client[0] : row.client;
        clientQuotations.push({
          type: "client_quotation",
          number: row.quotation_number,
          customerName: row.bill_to_name || client?.client_name || "Customer",
          status: row.status,
          totalGhs: row.total_amount_due,
          issueDate: row.issue_date,
        });
      }
      resultIndex += 1;
    }

    if (canAccessCrmSection(sessionResult.session.role) || canAccessPosSection(sessionResult.session.role)) {
      const rows = ((results[resultIndex]?.data as SalesQuoteListRow[] | null) ?? [])
        .map(normalizeSalesQuoteListRow)
        .slice(0, LIST_LIMIT);
      for (const row of rows) {
        const client = Array.isArray(row.client) ? row.client[0] : row.client;
        productQuotes.push({
          type: "product_quote",
          number: row.quote_number,
          customerName: row.bill_to_name || client?.client_name || "Customer",
          status: row.status,
          totalGhs: row.total_amount,
          quoteDate: row.quote_date,
        });
      }
    }

    return {
      openClientQuotations: clientQuotations,
      openProductQuotes: productQuotes,
      totalOpenCount: clientQuotations.length + productQuotes.length,
    };
  } catch (error) {
    console.error("[assistant] get_quotes_and_quotations_status threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getCommissionSummary(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessCrmSection(sessionResult.session.role)) {
    return { error: "You do not have access to commission data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const { data, error } = await supabase
      .from("commission_calculations")
      .select(COMMISSION_CALCULATION_LIST_SELECT)
      .order("calculated_at", { ascending: false })
      .limit(LIST_LIMIT);

    if (error) {
      console.error("[assistant] get_commission_summary failed:", error.message);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const rows = ((data as CommissionCalculationRow[] | null) ?? []).map(
      normalizeCommissionCalculationRow,
    );
    const pending = rows.filter((row) => row.status === "pending");
    const recent = rows.slice(0, LIST_LIMIT);

    return {
      pendingCount: pending.length,
      pendingTotalGhs: pending.reduce(
        (sum, row) => sum + (Number(row.commission_amount) || 0),
        0,
      ),
      recentCalculations: recent.map((row) => ({
        status: row.status,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        commissionAmountGhs: row.commission_amount,
        calculatedAt: row.calculated_at,
      })),
    };
  } catch (error) {
    console.error("[assistant] get_commission_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}