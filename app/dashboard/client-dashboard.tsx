"use client";

import Link from "next/link";
import { formatGHS } from "./finance/income-register-utils";
import type { ClientDashboardSummary } from "./client-dashboard-utils";

type ClientDashboardProps = {
  summary: ClientDashboardSummary;
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

export default function ClientDashboard({
  summary,
  fetchError,
}: ClientDashboardProps) {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#0f2744]">Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          Welcome back, {summary.clientName}. Here is a quick summary of your
          account for {summary.periodLabel}.
        </p>
      </div>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="Outstanding Balance"
          subtitle={`${summary.invoiceCount} service invoice${summary.invoiceCount === 1 ? "" : "s"}`}
          value={formatGHS(summary.outstandingBalance)}
          href="/dashboard/client-portal/invoices"
        />
        <SummaryCard
          title="Your Sites"
          subtitle={`${summary.passedInspectionsThisMonth} passed inspection${summary.passedInspectionsThisMonth === 1 ? "" : "s"} this month`}
          value={`${summary.siteCount} site${summary.siteCount === 1 ? "" : "s"}`}
          href="/dashboard/client-portal/sites-performance"
        />
        <SummaryCard
          title="Monthly Service Report"
          subtitle="View your latest service delivery summary"
          value="Open report"
          href="/dashboard/client-portal/service-report"
        />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[#0f2744]">This Month at a Glance</h2>
        <p className="mt-2 text-sm text-slate-600">
          {summary.inspectionsThisMonth > 0
            ? `${summary.inspectionsThisMonth} inspection${summary.inspectionsThisMonth === 1 ? "" : "s"} recorded across your sites in ${summary.periodLabel}, with ${summary.passedInspectionsThisMonth} marked as passed.`
            : `No inspections recorded yet for your sites in ${summary.periodLabel}.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/dashboard/client-portal/invoices"
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            View My Invoices
          </Link>
          <Link
            href="/dashboard/client-portal/service-report"
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            View Service Report
          </Link>
          <Link
            href="/dashboard/client-portal/sites-performance"
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            View Sites Performance
          </Link>
        </div>
      </section>
    </div>
  );
}
