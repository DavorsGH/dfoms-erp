import { isActiveIncomeForReporting } from "./finance/income-register-utils";
import type { CrmSaleEntry } from "./crm/sales/sales-utils";
import {
  aggregateTop,
  entryInAnalysisPeriod,
  type SpendingAnalysisPeriodMode,
  type SpendingAnalysisRankedItem,
} from "./dashboard-spending-analysis-utils";

export type SalesAnalysisGrouping = "product" | "customer";

export type SalesAnalysisRow = {
  date: string;
  amount: number;
  product_name: string;
  customer_name: string;
};

export type SalesAnalysisPeriodMode = SpendingAnalysisPeriodMode;
export type SalesAnalysisRankedItem = SpendingAnalysisRankedItem;

export function toSalesAnalysisRows(sales: CrmSaleEntry[]): SalesAnalysisRow[] {
  return sales
    .filter((sale) => {
      if (sale.source !== "product_sale") {
        return true;
      }

      return isActiveIncomeForReporting({
        entry_type: "product_sale",
        sale_status: sale.sale_status === "voided" ? "voided" : "active",
      });
    })
    .map((sale) => ({
      date: sale.sale_date,
      amount: Number(sale.amount) || 0,
      product_name: sale.product_name,
      customer_name: sale.customer_name,
    }));
}

export function buildTopSalesAnalysis(
  rows: SalesAnalysisRow[],
  mode: SalesAnalysisPeriodMode,
  periodKey: string,
  grouping: SalesAnalysisGrouping,
): SalesAnalysisRankedItem[] {
  const inPeriod = rows.filter((row) =>
    entryInAnalysisPeriod(row.date, mode, periodKey),
  );

  return aggregateTop(
    inPeriod.map((row) => ({
      label: grouping === "product" ? row.product_name : row.customer_name,
      amount: row.amount,
    })),
  );
}
