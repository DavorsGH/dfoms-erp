import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesRepDashboardSummary = {
  periodLabel: string;
  todayLabel: string;
  todaysSalesTotal: number;
  todaysSaleCount: number;
  monthSalesTotal: number;
  monthSaleCount: number;
};

type ProductSaleRow = {
  date: string;
  amount: number | string | null;
  sale_status: string | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthPrefix(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function isActiveSale(row: ProductSaleRow): boolean {
  return row.sale_status !== "voided";
}

function saleAmount(row: ProductSaleRow): number {
  return Number(row.amount) || 0;
}

export async function buildSalesRepDashboardSummary(
  supabase: SupabaseClient,
): Promise<{ summary: SalesRepDashboardSummary | null; fetchError: string | null }> {
  const today = todayIsoDate();
  const monthPrefix = currentMonthPrefix();
  const now = new Date();

  const { data, error } = await supabase
    .from("income_register")
    .select("date, amount, sale_status")
    .eq("entry_type", "product_sale");

  if (error) {
    return { summary: null, fetchError: error.message };
  }

  const activeSales = ((data as ProductSaleRow[] | null) ?? []).filter(isActiveSale);

  let todaysSalesTotal = 0;
  let todaysSaleCount = 0;
  let monthSalesTotal = 0;
  let monthSaleCount = 0;

  for (const row of activeSales) {
    const amount = saleAmount(row);

    if (row.date === today) {
      todaysSalesTotal += amount;
      todaysSaleCount += 1;
    }

    if (row.date.startsWith(monthPrefix)) {
      monthSalesTotal += amount;
      monthSaleCount += 1;
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
      todaysSalesTotal,
      todaysSaleCount,
      monthSalesTotal,
      monthSaleCount,
    },
    fetchError: null,
  };
}
