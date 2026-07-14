"use client";

import Link from "next/link";
import type { OperationsDashboardSummary } from "./operations-dashboard-utils";

type OperationsDashboardProps = {
  summary: OperationsDashboardSummary;
  fetchError: string | null;
  roleLabel: string;
};

function SummaryCard({
  title,
  value,
  subtitle,
  href,
  tone = "default",
}: {
  title: string;
  value: string;
  subtitle?: string;
  href: string;
  tone?: "default" | "warning";
}) {
  const toneClasses =
    tone === "warning"
      ? "border-amber-200 bg-amber-50"
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

export default function OperationsDashboard({
  summary,
  fetchError,
  roleLabel,
}: OperationsDashboardProps) {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#0f2744]">Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          {roleLabel} overview for {summary.periodLabel} — roster coverage,
          inspections, and work orders.
        </p>
      </div>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="Understaffed Sites"
          subtitle={`${summary.totalRosterSites} roster sites company-wide`}
          value={String(summary.understaffedSites)}
          href="/dashboard/operations/duty-roster"
          tone={summary.understaffedSites > 0 ? "warning" : "default"}
        />
        <SummaryCard
          title="Open Corrective Actions"
          subtitle="Outstanding follow-up items"
          value={String(summary.openCorrectiveActions)}
          href="/dashboard/operations/corrective-actions"
        />
        <SummaryCard
          title="Failed Inspections"
          subtitle="Issues requiring attention"
          value={String(summary.openFailedInspections)}
          href="/dashboard/operations/failed-inspections"
        />
        <SummaryCard
          title="Work Orders"
          subtitle={summary.periodLabel}
          value={String(summary.workOrdersThisMonth)}
          href="/dashboard/operations/work-orders"
        />
        <SummaryCard
          title="Inspections"
          subtitle={summary.periodLabel}
          value={String(summary.inspectionsThisMonth)}
          href="/dashboard/operations/inspection-summary"
        />
        <SummaryCard
          title="Duty Roster"
          subtitle="View full company roster"
          value="Open roster"
          href="/dashboard/operations/duty-roster"
        />
      </div>
    </div>
  );
}
