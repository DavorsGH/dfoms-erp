"use client";

import Link from "next/link";
import { formatGHS } from "./finance/income-register-utils";
import type { SalesRepDashboardSummary } from "./sales-rep-dashboard-utils";

type SalesRepDashboardProps = {
  summary: SalesRepDashboardSummary;
  fetchError: string | null;
};

function SummaryCard({
  title,
  value,
  subtitle,
  href,
}: {
  title: string;
  value: string;
  subtitle?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-[#0f2744] hover:shadow-md"
    >
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle ? (
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      ) : null}
      <p className="mt-2 text-2xl font-semibold text-[#0f2744]">{value}</p>
    </Link>
  );
}

export default function SalesRepDashboard({
  summary,
  fetchError,
}: SalesRepDashboardProps) {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#0f2744]">Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          Product sales summary for {summary.periodLabel}.
        </p>
      </div>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard
          title="Today's Sales"
          subtitle={`${summary.todaysSaleCount} sale${summary.todaysSaleCount === 1 ? "" : "s"} on ${summary.todayLabel}`}
          value={formatGHS(summary.todaysSalesTotal)}
          href="/dashboard/pos"
        />
        <SummaryCard
          title="This Month's Sales"
          subtitle={`${summary.monthSaleCount} sale${summary.monthSaleCount === 1 ? "" : "s"} in ${summary.periodLabel}`}
          value={formatGHS(summary.monthSalesTotal)}
          href="/dashboard/pos"
        />
      </div>
    </div>
  );
}
