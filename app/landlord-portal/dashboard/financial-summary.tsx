"use client";

import { useMemo, useState } from "react";
import { inputClassName } from "@/app/dashboard/employees/employee-record-utils";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { SummaryCard } from "@/app/dashboard/summary-card";
import type { LandlordPortalFinancialSummaryViewModel } from "./financial-summary-utils";

type LandlordPortalFinancialSummaryProps = {
  data: LandlordPortalFinancialSummaryViewModel;
  revenueHref: string;
  expensesHref: string;
  netProfitHref: string;
};

export default function LandlordPortalFinancialSummary({
  data,
  revenueHref,
  expensesHref,
  netProfitHref,
}: LandlordPortalFinancialSummaryProps) {
  const [selectedMonthKey, setSelectedMonthKey] = useState(data.defaultMonthKey);
  const isYtdMode = selectedMonthKey === "ytd";

  const selectedSnapshot = useMemo(() => {
    return (
      data.monthSnapshots[isYtdMode ? data.defaultMonthKey : selectedMonthKey] ??
      data.monthSnapshots[data.defaultMonthKey]
    );
  }, [data.defaultMonthKey, data.monthSnapshots, isYtdMode, selectedMonthKey]);

  const summary = selectedSnapshot;
  if (!summary) {
    return null;
  }

  const selectedPeriodLabel = isYtdMode ? "YTD" : summary.periodLabel;
  const netProfitCardTitle = isYtdMode ? "Net Profit (YTD)" : "Net Profit (Month)";
  const netProfitCardSubtitle = isYtdMode
    ? summary.ytdThroughLabel
    : summary.periodLabel;
  const displayedRevenue = isYtdMode
    ? summary.totalRevenueYtd
    : summary.totalRevenue;
  const displayedExpenses = isYtdMode
    ? summary.totalExpensesYtd
    : summary.totalExpenses;
  const displayedNetProfit = isYtdMode
    ? summary.netProfitYtd
    : summary.netProfit;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0f2744]">
            Financial summary
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Rent collected as revenue, property expenses as expenses — net =
            revenue − expenses for {summary.periodLabel}.
          </p>
        </div>
        <div className="min-w-[220px]">
          <label
            htmlFor="landlord-dashboard-month"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Summary Month
          </label>
          <select
            id="landlord-dashboard-month"
            value={selectedMonthKey}
            onChange={(event) => setSelectedMonthKey(event.target.value)}
            className={inputClassName}
          >
            <option value="ytd">YTD</option>
            {data.monthOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Net Profit (YTD)"
          subtitle={summary.ytdThroughLabel}
          value={formatGHS(summary.netProfitYtd)}
          href={netProfitHref}
          tone="ytd"
        />
        <SummaryCard
          title={`Total Revenue (${selectedPeriodLabel})`}
          value={formatGHS(displayedRevenue)}
          href={revenueHref}
        />
        <SummaryCard
          title={`Total Expenses (${selectedPeriodLabel})`}
          value={formatGHS(displayedExpenses)}
          href={expensesHref}
        />
        <SummaryCard
          title={netProfitCardTitle}
          subtitle={netProfitCardSubtitle}
          value={formatGHS(displayedNetProfit)}
          href={netProfitHref}
        />
      </div>
    </section>
  );
}
