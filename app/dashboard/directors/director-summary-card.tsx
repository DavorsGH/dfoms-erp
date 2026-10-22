"use client";

import Link from "next/link";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import type { DirectorScorecardSnapshot } from "@/app/dashboard/director-scorecard-build";
import { directorsBoardHref } from "./directors-nav-config";

type DirectorSummaryCardProps = {
  snapshot: DirectorScorecardSnapshot;
  monthKey: string;
};

function readinessLabel(snapshot: DirectorScorecardSnapshot): string {
  if (snapshot.checklist.ready) {
    return "Ready";
  }
  let todo = 0;
  let overdue = 0;
  for (const item of snapshot.checklist.items) {
    if (item.chipStatus === "overdue") {
      overdue += 1;
    } else if (item.chipStatus !== "done" && item.chipStatus !== "not-enough-data") {
      todo += 1;
    }
  }
  const parts: string[] = ["Not yet"];
  if (todo > 0) {
    parts.push(`${todo} to do`);
  }
  if (overdue > 0) {
    parts.push(`${overdue} overdue`);
  }
  return parts.join(" — ");
}

export default function DirectorSummaryCard({
  snapshot,
  monthKey,
}: DirectorSummaryCardProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0f2744]">Director&apos;s summary</h2>
          <p className="mt-1 text-sm text-slate-600">
            {snapshot.periodLabel} — planning view (same registers as Finance).
          </p>
        </div>
        <Link
          href={directorsBoardHref("scorecard", monthKey)}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c]"
        >
          Open Directors board
        </Link>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-600">Profit before tax</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[#0f2744]">
            {formatGHS(snapshot.profitBeforeTax)}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-600">Tax to set aside</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[#0f2744]">
            {formatGHS(snapshot.taxToSetAside)}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-600">Dividend readiness</p>
          <p className="mt-1 text-sm font-medium text-[#0f2744]">
            {readinessLabel(snapshot)}
          </p>
        </div>
      </div>
    </section>
  );
}
