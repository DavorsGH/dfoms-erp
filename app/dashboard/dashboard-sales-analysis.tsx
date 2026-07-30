"use client";

import { useMemo, useState } from "react";
import { inputClassName } from "./employees/employee-record-utils";
import {
  AnalysisRankedList,
} from "./dashboard-spending-analysis";
import {
  collectAnalysisMonthKeys,
  collectAnalysisYearKeys,
  formatAnalysisMonthLabel,
} from "./dashboard-spending-analysis-utils";
import {
  buildTopSalesAnalysis,
  type SalesAnalysisGrouping,
  type SalesAnalysisPeriodMode,
  type SalesAnalysisRow,
} from "./dashboard-sales-analysis-utils";

type DashboardSalesAnalysisProps = {
  salesEntries: SalesAnalysisRow[];
};

export default function DashboardSalesAnalysis({
  salesEntries,
}: DashboardSalesAnalysisProps) {
  const monthKeys = useMemo(
    () => collectAnalysisMonthKeys(salesEntries),
    [salesEntries],
  );
  const yearKeys = useMemo(
    () => collectAnalysisYearKeys(salesEntries),
    [salesEntries],
  );

  const [periodMode, setPeriodMode] =
    useState<SalesAnalysisPeriodMode>("month");
  const [monthKey, setMonthKey] = useState(monthKeys[0] ?? "");
  const [yearKey, setYearKey] = useState(yearKeys[0] ?? "");
  const [grouping, setGrouping] = useState<SalesAnalysisGrouping>("product");

  const periodKey = periodMode === "month" ? monthKey : yearKey;

  const topSales = useMemo(
    () => buildTopSalesAnalysis(salesEntries, periodMode, periodKey, grouping),
    [salesEntries, periodMode, periodKey, grouping],
  );

  const periodLabel =
    periodMode === "month"
      ? formatAnalysisMonthLabel(monthKey)
      : yearKey || "—";

  const groupingLabel =
    grouping === "product" ? "By Product" : "By Customer";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0f2744]">
            Top Sales Analysis
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Ranked from Product Sales and Sales Log totals for {periodLabel} (
            {groupingLabel}).
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Period</p>
            <div className="inline-flex rounded-md border border-slate-300 p-0.5">
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  periodMode === "month"
                    ? "bg-[#0f2744] text-white"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setPeriodMode("month")}
              >
                Month
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  periodMode === "year"
                    ? "bg-[#0f2744] text-white"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setPeriodMode("year")}
              >
                Year
              </button>
            </div>
          </div>

          {periodMode === "month" ? (
            <div className="min-w-[180px]">
              <label
                htmlFor="sales-analysis-month"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Month
              </label>
              <select
                id="sales-analysis-month"
                value={monthKey}
                onChange={(event) => setMonthKey(event.target.value)}
                className={inputClassName}
              >
                {monthKeys.map((key) => (
                  <option key={key} value={key}>
                    {formatAnalysisMonthLabel(key)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="min-w-[120px]">
              <label
                htmlFor="sales-analysis-year"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Year
              </label>
              <select
                id="sales-analysis-year"
                value={yearKey}
                onChange={(event) => setYearKey(event.target.value)}
                className={inputClassName}
              >
                {yearKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Grouping</p>
            <div className="inline-flex rounded-md border border-slate-300 p-0.5">
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  grouping === "product"
                    ? "bg-[#0f2744] text-white"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setGrouping("product")}
              >
                By Product
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  grouping === "customer"
                    ? "bg-[#0f2744] text-white"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setGrouping("customer")}
              >
                By Customer
              </button>
            </div>
          </div>
        </div>
      </div>

      <AnalysisRankedList
        title="Top 10 Sales"
        items={topSales}
        emptyLabel="No sales in this period."
      />
    </section>
  );
}
