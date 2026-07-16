"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inputClassName } from "./employees/employee-record-utils";
import { formatGHS } from "./finance/income-register-utils";
import type { DashboardViewModel } from "./dashboard-utils";
import type { DashboardVisibility } from "@/utils/rbac-access";

type DashboardProps = {
  data: DashboardViewModel;
  fetchError: string | null;
  visibility: DashboardVisibility;
};

function SummaryCard({
  title,
  subtitle,
  value,
  href,
  tone = "default",
}: {
  title: string;
  subtitle?: string;
  value: string;
  href: string;
  tone?: "default" | "success" | "danger" | "ytd";
}) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "danger"
        ? "border-red-200 bg-red-50"
        : tone === "ytd"
          ? "border-[#0f2744]/20 bg-slate-100 ring-1 ring-[#0f2744]/10"
          : "border-slate-200 bg-white";

  return (
    <Link
      href={href}
      className={`rounded-lg border p-5 shadow-sm transition-colors hover:border-[#0f2744] hover:shadow-md ${toneClasses}`}
    >
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle ? (
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      ) : null}
      <p className="mt-2 text-2xl font-semibold text-[#0f2744]">{value}</p>
    </Link>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">{title}</h2>
      <div className="h-72">{children}</div>
    </section>
  );
}

function formatChartCurrency(value: number): string {
  return formatGHS(value);
}

export default function Dashboard({ data, fetchError, visibility }: DashboardProps) {
  const [selectedMonthKey, setSelectedMonthKey] = useState(data.defaultMonthKey);
  const isYtdMode = selectedMonthKey === "ytd";

  const selectedSnapshot = useMemo(() => {
    return (
      data.monthSnapshots[isYtdMode ? data.defaultMonthKey : selectedMonthKey] ??
      data.monthSnapshots[data.defaultMonthKey]
    );
  }, [data.defaultMonthKey, data.monthSnapshots, isYtdMode, selectedMonthKey]);

  const { summary, payroll } = selectedSnapshot;
  const { profitTrend, cashTrend, payrollTrend } = data;
  const selectedPeriodLabel = isYtdMode ? "YTD" : summary.periodLabel;
  const netProfitCardTitle = isYtdMode ? "Net Profit (YTD)" : "Net Profit (Month)";
  const netProfitCardSubtitle = isYtdMode ? summary.ytdThroughLabel : summary.periodLabel;
  const displayedRevenue = isYtdMode ? summary.totalRevenueYtd : summary.totalRevenue;
  const displayedExpenses = isYtdMode
    ? summary.totalExpensesYtd
    : summary.totalExpenses;
  const displayedNetProfit = isYtdMode ? summary.netProfitYtd : summary.netProfit;
  const displayedPayrollCost = isYtdMode
    ? payroll.totalPayrollCostYtd
    : payroll.totalPayrollCost;
  const asOfLabel = `as of ${summary.periodLabel}`;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#0f2744]">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            At-a-glance summary for {summary.periodLabel}, calculated live from
            your registers.
          </p>
        </div>
        <div className="min-w-[220px]">
          <label
            htmlFor="dashboard-month"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Summary Month
          </label>
          <select
            id="dashboard-month"
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

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      {visibility.showInventoryAlerts && data.lowStockRawMaterialCount > 0 ? (
        <Link
          href="/dashboard/reports/inventory/stock-on-hand?lowStock=1"
          className="block rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 transition-colors hover:border-amber-400 hover:bg-amber-100"
        >
          <span className="font-semibold">Low stock alert:</span>{" "}
          {data.lowStockRawMaterialCount} raw material
          {data.lowStockRawMaterialCount === 1 ? " is" : "s are"} at or below
          reorder level. View low-stock items in Stock on Hand report.
        </Link>
      ) : null}

      {visibility.showFinancialSummary ? (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <SummaryCard
          title="Net Profit (YTD)"
          subtitle={summary.ytdThroughLabel}
          value={formatGHS(summary.netProfitYtd)}
          href="/dashboard/finance/profit-loss"
          tone="ytd"
        />
        <SummaryCard
          title={`Total Revenue (${selectedPeriodLabel})`}
          value={formatGHS(displayedRevenue)}
          href="/dashboard/finance"
        />
        <SummaryCard
          title={`Total Expenses (${selectedPeriodLabel})`}
          value={formatGHS(displayedExpenses)}
          href="/dashboard/finance/expenses"
        />
        <SummaryCard
          title={netProfitCardTitle}
          subtitle={netProfitCardSubtitle}
          value={formatGHS(displayedNetProfit)}
          href="/dashboard/finance/profit-loss"
        />
        <SummaryCard
          title="Cash Position"
          subtitle={asOfLabel}
          value={formatGHS(summary.cashPosition)}
          href="/dashboard/finance/balance-sheet"
        />
        <SummaryCard
          title="Balance Sheet Check"
          subtitle={asOfLabel}
          value={
            summary.balanceCheck.isBalanced
              ? "Balanced"
              : `Out of balance by ${formatGHS(Math.abs(summary.balanceCheck.difference))}`
          }
          href="/dashboard/finance/balance-sheet"
          tone={summary.balanceCheck.isBalanced ? "success" : "danger"}
        />
      </div>
      ) : null}

      {visibility.showFinancialCharts ? (
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Revenue, Expenses & Net Profit (Last 6 Months)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={profitTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatChartCurrency(Number(value))} />
              <Legend />
              <Bar dataKey="revenue" fill="#0f2744" name="Revenue" />
              <Bar dataKey="expenses" fill="#94a3b8" name="Expenses" />
              <Bar dataKey="netProfit" fill="#059669" name="Net Profit" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Cash and Cash Equivalents (Last 6 Months)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cashTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatChartCurrency(Number(value))} />
              <Legend />
              <Line
                type="monotone"
                dataKey="cash"
                stroke="#0f2744"
                strokeWidth={2}
                name="Cash"
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      ) : null}

      {visibility.showPayrollPanel ? (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#0f2744]">
              Payroll Status
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Payroll activity and statutory liabilities for {payroll.periodLabel}.
            </p>
          </div>
          <Link
            href="/dashboard/hr-payroll/payroll-processing"
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            Open Payroll Processing
          </Link>
        </div>

        {payroll.payrollNotProcessed ? (
          <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {payroll.periodLabel} payroll not yet processed.{" "}
            <Link
              href="/dashboard/hr-payroll/payroll-processing"
              className="font-medium underline underline-offset-2"
            >
              Go to Payroll Processing
            </Link>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Link
            href="/dashboard/hr-payroll/payroll-processing"
            className="rounded-md border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-[#0f2744]"
          >
            <p className="text-sm text-slate-600">Lock Status</p>
            <p className="mt-1 text-lg font-semibold text-[#0f2744]">
              {payroll.lockStatus}
            </p>
          </Link>
          <Link
            href="/dashboard/hr-payroll/payroll-processing"
            className="rounded-md border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-[#0f2744]"
          >
            <p className="text-sm text-slate-600">
              Total Payroll Cost ({selectedPeriodLabel})
            </p>
            <p className="mt-1 text-lg font-semibold text-[#0f2744]">
              {formatGHS(displayedPayrollCost)}
            </p>
          </Link>
          <Link
            href="/dashboard/finance/accounts-payable"
            className="rounded-md border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-[#0f2744]"
          >
            <p className="text-sm text-slate-600">
              Pending Payroll Liabilities
              {payroll.liabilityReferenceLabel
                ? ` (${payroll.liabilityReferenceLabel})`
                : ""}
            </p>
            <p className="mt-1 text-lg font-semibold text-[#0f2744]">
              {formatGHS(payroll.pendingPayrollLiabilities)}
            </p>
          </Link>
        </div>

        <div className="mt-6 h-56">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Total Payroll Cost Trend (Last 6 Months)
          </h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={payrollTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatChartCurrency(Number(value))} />
              <Line
                type="monotone"
                dataKey="payrollCost"
                stroke="#b45309"
                strokeWidth={2}
                name="Payroll Cost"
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
      ) : null}
    </div>
  );
}
