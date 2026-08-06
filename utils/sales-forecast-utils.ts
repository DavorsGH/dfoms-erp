import { toNumber, roundMoney } from "@/utils/client-invoices-types";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import type { SalesTargetListRow } from "@/utils/sales-targets-types";

export type ForecastOpportunityRow = {
  estimated_value: number | null;
  probability: number | null;
  expected_close_date: string | null;
  stage: string;
};

export type ForecastProductSaleRow = {
  date: string;
  amount: number;
  sale_status: string | null;
};

export type ForecastInvoiceRow = {
  invoice_date: string;
  total_amount_due: number;
  status: string;
};

export type ForecastMonthBucket = {
  monthKey: string;
  monthLabel: string;
  pipelineWeighted: number;
  actualRevenue: number;
  targetRevenue: number | null;
};

export function monthKeyFromDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  return date.slice(0, 7);
}

export function formatForecastMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }

  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

export function isOpenPipelineStage(stage: string) {
  return stage !== "won" && stage !== "lost";
}

export function isVoidedProductSale(saleStatus: string | null | undefined) {
  return saleStatus === "voided";
}

export function buildForecastMonthBuckets(input: {
  opportunities: ForecastOpportunityRow[];
  productSales: ForecastProductSaleRow[];
  invoices: ForecastInvoiceRow[];
  targets: SalesTargetListRow[];
  rangeStart: string;
  rangeEnd: string;
}): ForecastMonthBucket[] {
  const monthKeys = enumerateMonthKeys(input.rangeStart, input.rangeEnd);
  const buckets = new Map<string, ForecastMonthBucket>();

  for (const monthKey of monthKeys) {
    buckets.set(monthKey, {
      monthKey,
      monthLabel: formatForecastMonthLabel(monthKey),
      pipelineWeighted: 0,
      actualRevenue: 0,
      targetRevenue: null,
    });
  }

  for (const opportunity of input.opportunities) {
    if (!isOpenPipelineStage(opportunity.stage)) {
      continue;
    }

    const monthKey = monthKeyFromDate(opportunity.expected_close_date);
    if (!monthKey || !buckets.has(monthKey)) {
      continue;
    }

    const estimated = toNumber(opportunity.estimated_value);
    const probability = toNumber(opportunity.probability);
    const weighted = roundMoney(estimated * (probability / 100));
    buckets.get(monthKey)!.pipelineWeighted = roundMoney(
      buckets.get(monthKey)!.pipelineWeighted + weighted,
    );
  }

  for (const sale of input.productSales) {
    if (isVoidedProductSale(sale.sale_status)) {
      continue;
    }

    const monthKey = monthKeyFromDate(sale.date);
    if (!monthKey || !buckets.has(monthKey)) {
      continue;
    }

    buckets.get(monthKey)!.actualRevenue = roundMoney(
      buckets.get(monthKey)!.actualRevenue + toNumber(sale.amount),
    );
  }

  for (const invoice of input.invoices) {
    if (invoice.status === "draft") {
      continue;
    }

    const monthKey = monthKeyFromDate(invoice.invoice_date);
    if (!monthKey || !buckets.has(monthKey)) {
      continue;
    }

    buckets.get(monthKey)!.actualRevenue = roundMoney(
      buckets.get(monthKey)!.actualRevenue + toNumber(invoice.total_amount_due),
    );
  }

  for (const target of input.targets) {
    for (const monthKey of monthKeys) {
      if (
        monthOverlapsTarget(monthKey, target.period_start, target.period_end)
      ) {
        const bucket = buckets.get(monthKey);
        if (!bucket) {
          continue;
        }

        bucket.targetRevenue = roundMoney(
          (bucket.targetRevenue ?? 0) + toNumber(target.revenue_target),
        );
      }
    }
  }

  return monthKeys.map((monthKey) => buckets.get(monthKey)!);
}

function enumerateMonthKeys(rangeStart: string, rangeEnd: string): string[] {
  const start = parseMonthStart(rangeStart);
  const end = parseMonthStart(rangeEnd);
  if (!start || !end || start > end) {
    return [];
  }

  const keys: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    keys.push(`${year}-${month}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return keys;
}

function parseMonthStart(value: string): Date | null {
  const monthKey = monthKeyFromDate(value);
  if (!monthKey) {
    return null;
  }

  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function monthOverlapsTarget(
  monthKey: string,
  periodStart: string,
  periodEnd: string,
) {
  const monthStart = parseMonthStart(`${monthKey}-01`);
  const monthEnd = new Date(monthStart!.getFullYear(), monthStart!.getMonth() + 1, 0);
  const targetStart = new Date(periodStart.slice(0, 10));
  const targetEnd = new Date(periodEnd.slice(0, 10));

  return monthStart! <= targetEnd && monthEnd >= targetStart;
}

export function formatForecastMoney(value: number | null | undefined) {
  return formatGHS(toNumber(value));
}

export function defaultForecastRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 5, 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
