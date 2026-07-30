"use client";

import { useMemo, useState } from "react";
import { inputClassName } from "./employees/employee-record-utils";
import { formatGHS } from "./finance/income-register-utils";
import {
  buildTopExpenseAnalysis,
  buildTopIncomeAnalysis,
  collectAnalysisMonthKeys,
  collectAnalysisYearKeys,
  formatAnalysisMonthLabel,
  type SpendingAnalysisExpenseRow,
  type SpendingAnalysisGrouping,
  type SpendingAnalysisIncomeRow,
  type SpendingAnalysisPeriodMode,
  type SpendingAnalysisRankedItem,
} from "./dashboard-spending-analysis-utils";

type DashboardSpendingAnalysisProps = {
  incomeEntries: SpendingAnalysisIncomeRow[];
  expenseEntries: SpendingAnalysisExpenseRow[];
};

function RankedList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: SpendingAnalysisRankedItem[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-[#0f2744]">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li
              key={`${item.label}-${index}`}
              className="flex items-start justify-between gap-3 text-sm"
            >
              <span className="min-w-0 text-slate-700">
                <span className="mr-2 font-medium text-slate-500">
                  {index + 1}.
                </span>
                <span className="break-words">{item.label}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums text-slate-900">
                {formatGHS(item.amount)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function DashboardSpendingAnalysis({
  incomeEntries,
  expenseEntries,
}: DashboardSpendingAnalysisProps) {
  const monthKeys = useMemo(
    () => collectAnalysisMonthKeys(incomeEntries, expenseEntries),
    [incomeEntries, expenseEntries],
  );
  const yearKeys = useMemo(
    () => collectAnalysisYearKeys(incomeEntries, expenseEntries),
    [incomeEntries, expenseEntries],
  );

  const [periodMode, setPeriodMode] =
    useState<SpendingAnalysisPeriodMode>("month");
  const [monthKey, setMonthKey] = useState(monthKeys[0] ?? "");
  const [yearKey, setYearKey] = useState(yearKeys[0] ?? "");
  const [grouping, setGrouping] =
    useState<SpendingAnalysisGrouping>("category");

  const periodKey = periodMode === "month" ? monthKey : yearKey;

  const topExpenses = useMemo(
    () =>
      buildTopExpenseAnalysis(
        expenseEntries,
        periodMode,
        periodKey,
        grouping,
      ),
    [expenseEntries, periodMode, periodKey, grouping],
  );

  const topIncome = useMemo(
    () =>
      buildTopIncomeAnalysis(incomeEntries, periodMode, periodKey, grouping),
    [incomeEntries, periodMode, periodKey, grouping],
  );

  const periodLabel =
    periodMode === "month"
      ? formatAnalysisMonthLabel(monthKey)
      : yearKey || "—";

  const groupingLabel =
    grouping === "category" ? "By Category" : "By Individual Item";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0f2744]">
            Top Spending / Earning Analysis
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Ranked from Income and Expense Register totals for {periodLabel} (
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
                htmlFor="spending-analysis-month"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Month
              </label>
              <select
                id="spending-analysis-month"
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
                htmlFor="spending-analysis-year"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Year
              </label>
              <select
                id="spending-analysis-year"
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
                  grouping === "category"
                    ? "bg-[#0f2744] text-white"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setGrouping("category")}
              >
                By Category
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  grouping === "item"
                    ? "bg-[#0f2744] text-white"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setGrouping("item")}
              >
                By Individual Item
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankedList
          title="Top 10 Expenses"
          items={topExpenses}
          emptyLabel="No expense entries in this period."
        />
        <RankedList
          title="Top 10 Income sources"
          items={topIncome}
          emptyLabel="No income entries in this period."
        />
      </div>
    </section>
  );
}
