"use client";

import { useState } from "react";
import Link from "next/link";
import { formatGHS } from "./finance/income-register-utils";
import type {
  DashboardBudgetStatusRow,
  DashboardBudgetStatusSnapshot,
} from "./dashboard-budget-status-utils";

type BudgetStatusPeriodMode = "month" | "ytd";

const cardClassName =
  "block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-[#0f2744] hover:shadow-md";

/** Same token as SummaryCard big numbers (Net Profit, Revenue, Expenses). */
const WITHIN_BUDGET_VALUE_CLASS =
  "text-2xl font-semibold tabular-nums text-[#0f2744]";
const OVER_BUDGET_VALUE_CLASS =
  "text-2xl font-semibold tabular-nums text-red-700";
const NO_BUDGET_VALUE_CLASS = "text-2xl font-semibold text-slate-500";

function periodFromMonthLabel(label: string): string {
  const match = /^Month \((.+)\)$/.exec(label);
  return match?.[1] ?? label;
}

function periodFromYtdLabel(label: string): string {
  const match = /^YTD \((.+)\)$/.exec(label);
  return match?.[1] ?? label;
}

function budgetStatusValueClassName(
  row: DashboardBudgetStatusRow,
  showNeutralEmptyState: boolean,
): string {
  if (showNeutralEmptyState || row.budgeted <= 0) {
    return NO_BUDGET_VALUE_CLASS;
  }

  // Within budget (under 100%, including amber 80–100%) → same navy as other metric cards.
  // Over budget only stays red.
  if (row.status === "red") {
    return OVER_BUDGET_VALUE_CLASS;
  }

  return WITHIN_BUDGET_VALUE_CLASS;
}

function BudgetStatusFigure({
  row,
  periodMode,
  monthPeriodLabel,
  ytdPeriodLabel,
}: {
  row: DashboardBudgetStatusRow;
  periodMode: BudgetStatusPeriodMode;
  monthPeriodLabel: string;
  ytdPeriodLabel: string;
}) {
  const showNeutralEmptyState = !row.hasBudgetLines && row.budgeted === 0;

  if (showNeutralEmptyState || row.budgeted <= 0) {
    return (
      <>
        <p className={budgetStatusValueClassName(row, showNeutralEmptyState)}>
          No budget set
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {periodMode === "month"
            ? `for ${monthPeriodLabel}`
            : `for YTD ${ytdPeriodLabel}`}
        </p>
      </>
    );
  }

  const utilizationLabel =
    row.utilizationPercent?.toLocaleString("en-GH", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) ?? "0.0";

  return (
    <>
      <p className={budgetStatusValueClassName(row, false)}>
        {formatGHS(row.actual)}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        of {formatGHS(row.budgeted)} budgeted · {utilizationLabel}% used
      </p>
    </>
  );
}

function stopCardNavigation(event: React.MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function DashboardBudgetStatusCard({
  snapshot,
}: {
  snapshot: DashboardBudgetStatusSnapshot;
}) {
  const [periodMode, setPeriodMode] = useState<BudgetStatusPeriodMode>("month");
  const activeRow = periodMode === "month" ? snapshot.month : snapshot.ytd;
  const monthPeriodLabel = periodFromMonthLabel(snapshot.month.label);
  const ytdPeriodLabel = periodFromYtdLabel(snapshot.ytd.label);
  const subtitle =
    periodMode === "month"
      ? monthPeriodLabel
      : `YTD (${ytdPeriodLabel})`;

  return (
    <Link
      href="/dashboard/reports/finance/budget-vs-actual"
      className={cardClassName}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">Budget Status</p>
        <div
          className="inline-flex shrink-0 rounded-md border border-slate-300 p-0.5"
          onClick={stopCardNavigation}
        >
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              periodMode === "month"
                ? "bg-[#0f2744] text-white"
                : "text-slate-700 hover:bg-slate-50"
            }`}
            onClick={(event) => {
              stopCardNavigation(event);
              setPeriodMode("month");
            }}
          >
            Month
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              periodMode === "ytd"
                ? "bg-[#0f2744] text-white"
                : "text-slate-700 hover:bg-slate-50"
            }`}
            onClick={(event) => {
              stopCardNavigation(event);
              setPeriodMode("ytd");
            }}
          >
            YTD
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      <div className="mt-2.5">
        <BudgetStatusFigure
          row={activeRow}
          periodMode={periodMode}
          monthPeriodLabel={monthPeriodLabel}
          ytdPeriodLabel={ytdPeriodLabel}
        />
      </div>
    </Link>
  );
}
