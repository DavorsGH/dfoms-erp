import type { SupabaseClient } from "@supabase/supabase-js";
import { productSaleChannelFromInvoice } from "@/app/dashboard/crm/sales/sales-utils";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

export type SalesRepDashboardSaleTotals = {
  todaysTotal: number;
  todaysCount: number;
  monthTotal: number;
  monthCount: number;
};

export type SalesRepDashboardSummary = {
  periodLabel: string;
  todayLabel: string;
  pos: SalesRepDashboardSaleTotals;
  productSales: SalesRepDashboardSaleTotals;
  openQuotationCount: number;
  draftQuotationCount: number;
};

type ProductSaleRow = {
  date: string;
  amount: number | string | null;
  sale_status: string | null;
  invoice_no: string | null;
};

type QuotationStatusRow = {
  status: string | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthPrefix(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function emptyTotals(): SalesRepDashboardSaleTotals {
  return {
    todaysTotal: 0,
    todaysCount: 0,
    monthTotal: 0,
    monthCount: 0,
  };
}

function isActiveSale(row: ProductSaleRow): boolean {
  return row.sale_status !== "voided";
}

function saleAmount(row: ProductSaleRow): number {
  return Number(row.amount) || 0;
}

function accumulateSaleTotals(
  totals: SalesRepDashboardSaleTotals,
  row: ProductSaleRow,
  today: string,
  monthPrefix: string,
): void {
  const amount = saleAmount(row);

  if (row.date === today) {
    totals.todaysTotal += amount;
    totals.todaysCount += 1;
  }

  if (row.date.startsWith(monthPrefix)) {
    totals.monthTotal += amount;
    totals.monthCount += 1;
  }
}

export async function buildSalesRepDashboardSummary(
  supabase: SupabaseClient,
  salesRepEmployeeId: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
): Promise<{ summary: SalesRepDashboardSummary | null; fetchError: string | null }> {
  const repId = salesRepEmployeeId.trim();
  if (!repId) {
    return {
      summary: null,
      fetchError: "Your user account is not linked to an employee record.",
    };
  }

  const today = todayIsoDate();
  const monthPrefix = currentMonthPrefix();
  const now = new Date();

  const [
    { data: salesData, error: salesError },
    { data: quotationRows, error: quotationsError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("income_register")
        .select("date, amount, sale_status, invoice_no")
        .eq("entry_type", "product_sale")
        .eq("sales_rep_id", repId),
      buScope,
    ),
    applyBusinessUnitScope(
      supabase
        .from("client_quotations")
        .select("status")
        .eq("assigned_sales_rep_id", repId),
      buScope,
    ),
  ]);

  if (salesError) {
    return { summary: null, fetchError: salesError.message };
  }

  if (quotationsError) {
    return { summary: null, fetchError: quotationsError.message };
  }

  const pos = emptyTotals();
  const productSales = emptyTotals();

  for (const row of ((salesData as ProductSaleRow[] | null) ?? []).filter(
    isActiveSale,
  )) {
    const channel = productSaleChannelFromInvoice(row.invoice_no);
    if (channel === "pos") {
      accumulateSaleTotals(pos, row, today, monthPrefix);
    } else if (channel === "psi") {
      accumulateSaleTotals(productSales, row, today, monthPrefix);
    }
  }

  let openQuotationCount = 0;
  let draftQuotationCount = 0;

  for (const row of (quotationRows as QuotationStatusRow[] | null) ?? []) {
    const status = row.status?.trim() ?? "";
    if (status === "sent") {
      openQuotationCount += 1;
    } else if (status === "draft") {
      draftQuotationCount += 1;
    }
  }

  return {
    summary: {
      periodLabel: now.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      }),
      todayLabel: now.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      pos,
      productSales,
      openQuotationCount,
      draftQuotationCount,
    },
    fetchError: null,
  };
}
