"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import type {
  DirectorScorecardChecklistChipStatus,
  DirectorScorecardChecklistItem,
  DirectorScorecardSnapshot,
} from "@/app/dashboard/director-scorecard-build";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import {
  budgetHealthStatusClassName,
  sumBudgetVsActualTotals,
  type BudgetHealthStatus,
  type BudgetVsActualRow,
} from "@/app/dashboard/reports/budget-vs-actual-utils";
import {
  DIRECTOR_SCORECARD_CIT_RATE,
  DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE,
  DIRECTOR_SCORECARD_GSL_RATE,
} from "@/lib/finance/director-scorecard-constants";
import {
  clientInvoiceDetailHref,
  expenseRegisterHrefForBudgetLine,
} from "@/app/dashboard/director-scorecard-links";

const SCORECARD_BUDGET_OPEN_KEY = "dfoms.scorecard.budgetOpen";
const SCORECARD_CHECKLIST_OPEN_KEY = "dfoms.scorecard.checklistOpen";

type DirectorScorecardSectionProps = {
  snapshot: DirectorScorecardSnapshot;
};

function readScorecardSectionOpen(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function writeScorecardSectionOpen(storageKey: string, open: boolean): void {
  try {
    localStorage.setItem(storageKey, open ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

/** Scorecard table only — Reports → Budget vs Actual uses `budgetHealthStatusLabel`. */
function scorecardBudgetHealthStatusLabel(status: BudgetHealthStatus): string {
  switch (status) {
    case "green":
      return "On track";
    case "amber":
      return "Near limit";
    case "red":
      return "Over budget";
  }
}

function Tile({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      ) : null}
      <p className="mt-2 text-xl font-semibold tabular-nums text-[#0f2744]">
        {value}
      </p>
    </div>
  );
}

function checklistChipClassName(status: DirectorScorecardChecklistChipStatus): string {
  switch (status) {
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "overdue":
      return "border-red-200 bg-red-50 text-red-800";
    case "not-enough-data":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "todo":
    default:
      return "border-amber-200 bg-amber-50 text-amber-950";
  }
}

function checklistChipLabel(status: DirectorScorecardChecklistChipStatus): string {
  switch (status) {
    case "done":
      return "Done";
    case "overdue":
      return "Overdue";
    case "not-enough-data":
      return "Not enough data";
    case "todo":
    default:
      return "To do";
  }
}

function ChecklistChip({ status }: { status: DirectorScorecardChecklistChipStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${checklistChipClassName(status)}`}
    >
      {checklistChipLabel(status)}
    </span>
  );
}

function formatVariancePercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

const scorecardActionLinkClassName =
  "inline-flex rounded-sm text-xs font-medium text-[#0f2744] underline decoration-slate-300 underline-offset-2 hover:decoration-[#0f2744] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f2744]";

const scorecardSectionToggleClassName =
  "shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f2744]";

function ChecklistItemMessage({ item }: { item: DirectorScorecardChecklistItem }) {
  if (item.unpaidInvoiceLinks?.length) {
    return (
      <p className="break-words text-sm text-slate-600">
        Waiting for payment:{" "}
        {item.unpaidInvoiceLinks.map((invoice, index) => (
          <span key={invoice.id}>
            {index > 0 ? ", " : null}
            <Link
              href={clientInvoiceDetailHref(invoice.id)}
              className={scorecardActionLinkClassName}
            >
              {invoice.invoiceNumber}
            </Link>
          </span>
        ))}
        .
      </p>
    );
  }

  return <p className="break-words text-sm text-slate-600">{item.reason}</p>;
}

function ChecklistItemLinks({ item }: { item: DirectorScorecardChecklistItem }) {
  if (!item.links?.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {item.links.map((link) => (
        <Link key={`${item.id}-${link.label}`} href={link.href} className={scorecardActionLinkClassName}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}

function ChecklistItemRow({ item }: { item: DirectorScorecardChecklistItem }) {
  return (
    <li className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
      <ChecklistChip status={item.chipStatus} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium text-[#0f2744]">{item.label}</p>
        <ChecklistItemMessage item={item} />
        <ChecklistItemLinks item={item} />
      </div>
    </li>
  );
}

function BudgetLineLink({
  row,
  year,
  month,
  className,
}: {
  row: BudgetVsActualRow;
  year: number;
  month: number;
  className?: string;
}) {
  return (
    <Link
      href={expenseRegisterHrefForBudgetLine({
        year,
        month,
        category: row.category,
        subcategory: row.subcategory,
      })}
      className={
        className ??
        "font-medium text-[#0f2744] underline decoration-slate-300 underline-offset-2 hover:decoration-[#0f2744] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f2744]"
      }
    >
      {row.rowLabel}
    </Link>
  );
}

function budgetOverAmount(row: BudgetVsActualRow): number {
  return Math.max(0, row.actual - row.budgeted);
}

function BudgetVsActualTable({
  snapshot,
  budgetTotals,
}: {
  snapshot: DirectorScorecardSnapshot;
  budgetTotals: ReturnType<typeof sumBudgetVsActualTotals>;
}) {
  return (
    <ScrollableTable boundedHeight={false}>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Line</th>
            <th className={`${scrollableTableThClassName} text-right`}>Budget</th>
            <th className={`${scrollableTableThClassName} text-right`}>Actual</th>
            <th className={`${scrollableTableThClassName} text-right`}>Variance</th>
            <th className={`${scrollableTableThClassName} text-right`}>Variance %</th>
            <th className={`${scrollableTableThClassName} text-right`}>Remaining</th>
            <th className={scrollableTableThClassName}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {snapshot.budget.rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                No budget or actual activity for this month.
              </td>
            </tr>
          ) : (
            snapshot.budget.rows.map((row, index) => (
              <tr key={row.rowKey} className={getStripedRowClassName(index)}>
                <td className="px-4 py-3 text-sm">
                  <BudgetLineLink row={row} year={snapshot.year} month={snapshot.month} />
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {formatGHS(row.budgeted)}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {formatGHS(row.actual)}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {formatGHS(row.variance)}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {formatVariancePercent(row.variancePercent)}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {formatGHS(row.remaining)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${budgetHealthStatusClassName(row.status)}`}
                  >
                    {scorecardBudgetHealthStatusLabel(row.status)}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
        {snapshot.budget.rows.length > 0 ? (
          <tfoot>
            <tr className="bg-slate-50 font-semibold text-[#0f2744]">
              <td className="px-4 py-3 text-sm">Total</td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">
                {formatGHS(budgetTotals.budgeted)}
              </td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">
                {formatGHS(budgetTotals.actual)}
              </td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">
                {formatGHS(budgetTotals.variance)}
              </td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">
                {formatVariancePercent(
                  budgetTotals.budgeted > 0
                    ? Math.round((budgetTotals.variance / budgetTotals.budgeted) * 10000) /
                        100
                    : null,
                )}
              </td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">
                {formatGHS(budgetTotals.remaining)}
              </td>
              <td className="px-4 py-3" />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </ScrollableTable>
  );
}

export default function DirectorScorecardSection({
  snapshot,
}: DirectorScorecardSectionProps) {
  const budgetTotals = sumBudgetVsActualTotals(snapshot.budget.rows);
  const reportHref = `/dashboard/reports/finance/budget-vs-actual?year=${snapshot.year}&month=${snapshot.month}`;
  const budgetHref = `/dashboard/finance/budget`;

  const [budgetOpen, setBudgetOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  useEffect(() => {
    setBudgetOpen(readScorecardSectionOpen(SCORECARD_BUDGET_OPEN_KEY));
    setChecklistOpen(readScorecardSectionOpen(SCORECARD_CHECKLIST_OPEN_KEY));
  }, []);

  const toggleBudgetOpen = useCallback(() => {
    setBudgetOpen((current) => {
      const next = !current;
      writeScorecardSectionOpen(SCORECARD_BUDGET_OPEN_KEY, next);
      return next;
    });
  }, []);

  const toggleChecklistOpen = useCallback(() => {
    setChecklistOpen((current) => {
      const next = !current;
      writeScorecardSectionOpen(SCORECARD_CHECKLIST_OPEN_KEY, next);
      return next;
    });
  }, []);

  const overBudgetRows = useMemo(
    () => snapshot.budget.rows.filter((row) => row.status === "red"),
    [snapshot.budget.rows],
  );

  const checklistCounts = useMemo(() => {
    let done = 0;
    let todo = 0;
    let overdue = 0;
    let notEnoughData = 0;
    for (const item of snapshot.checklist.items) {
      if (item.chipStatus === "done") {
        done += 1;
      } else if (item.chipStatus === "overdue") {
        overdue += 1;
      } else if (item.chipStatus === "not-enough-data") {
        notEnoughData += 1;
      } else {
        todo += 1;
      }
    }
    return { done, todo, overdue, notEnoughData };
  }, [snapshot.checklist.items]);

  const collapsedChecklistItems = useMemo(
    () =>
      snapshot.checklist.items.filter(
        (item) =>
          item.chipStatus === "overdue" ||
          item.chipStatus === "not-enough-data",
      ),
    [snapshot.checklist.items],
  );

  const budgetSummarySuffix = useMemo(() => {
    const parts = [
      `${formatGHS(budgetTotals.budgeted)} budgeted`,
      `${formatGHS(budgetTotals.actual)} spent`,
    ];
    if (overBudgetRows.length > 0) {
      parts.push(
        `${overBudgetRows.length} over budget`,
      );
    }
    return parts.join(" · ");
  }, [budgetTotals.budgeted, budgetTotals.actual, overBudgetRows.length]);

  const checklistBannerText = snapshot.checklist.ready
    ? "Ready — all checks complete. You can declare a dividend."
    : [
        "Not yet",
        `${checklistCounts.done} done`,
        `${checklistCounts.todo} to do`,
        `${checklistCounts.overdue} overdue`,
        checklistCounts.notEnoughData > 0
          ? `${checklistCounts.notEnoughData} not enough data`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

  const lineCount = snapshot.budget.rows.length;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#0f2744]">
            Director&apos;s Scorecard
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Planning view for {snapshot.periodLabel} (same registers and reports
            as Finance).
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Tile title="Revenue" value={formatGHS(snapshot.revenue)} />
        <Tile title="Total costs" value={formatGHS(snapshot.totalCosts)} />
        <Tile
          title="Profit before tax"
          value={formatGHS(snapshot.profitBeforeTax)}
        />
        <Tile
          title="Tax to set aside"
          value={formatGHS(snapshot.taxToSetAside)}
          subtitle={`CIT ${formatGHS(snapshot.taxDetail.citAmount)}, GSL ${formatGHS(snapshot.taxDetail.gslAmount)}, WHT credit ${formatGHS(snapshot.taxDetail.whtCreditApplied)}`}
        />
        <Tile
          title="Profit after tax"
          value={formatGHS(snapshot.profitAfterTax)}
          subtitle={`Reserve ${formatGHS(snapshot.reserveAmount)} · Reinvest ${formatGHS(snapshot.reinvestAmount)} · Owners ${formatGHS(snapshot.ownersShareAmount)}`}
        />
        <Tile
          title="Dividend available this quarter"
          value={formatGHS(snapshot.dividendQuarter.net)}
          subtitle={`${snapshot.dividendQuarter.quarterLabel}: gross ${formatGHS(snapshot.dividendQuarter.gross)}, WHT ${formatGHS(snapshot.dividendQuarter.wht)}`}
        />
      </div>

      <div className="mt-8 rounded-lg border border-slate-200">
        {!snapshot.budget.hasBudgetLines ? (
          <div className="p-4">
            <h3 className="text-base font-semibold text-[#0f2744]">
              Budget vs actual ({snapshot.budget.periodLabel})
            </h3>
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              No budget set for {snapshot.budget.periodLabel}.{" "}
              <Link href={budgetHref} className="font-medium text-[#0f2744] hover:underline">
                Set budget in Finance
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-base font-semibold text-[#0f2744]">
                  Budget vs actual ({snapshot.budget.periodLabel})
                </h3>
                <p className="text-sm text-slate-600">{budgetSummarySuffix}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Link
                  href={reportHref}
                  className="text-sm font-medium text-[#0f2744] hover:underline"
                >
                  Open Budget vs Actual report
                </Link>
                {lineCount > 0 ? (
                  <button
                    type="button"
                    className={scorecardSectionToggleClassName}
                    aria-expanded={budgetOpen}
                    aria-controls="scorecard-budget-panel"
                    onClick={toggleBudgetOpen}
                  >
                    {budgetOpen
                      ? "Hide lines ▾"
                      : `Show all ${lineCount} lines ▸`}
                  </button>
                ) : null}
              </div>
            </div>

            {!budgetOpen ? (
              <div className="space-y-2 p-4" id="scorecard-budget-panel">
                {overBudgetRows.length === 0 ? (
                  <p className="text-sm font-medium text-emerald-800">
                    All lines within budget.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {overBudgetRows.map((row) => (
                      <li
                        key={row.rowKey}
                        className="text-sm text-slate-700"
                      >
                        <BudgetLineLink
                          row={row}
                          year={snapshot.year}
                          month={snapshot.month}
                          className={`${scorecardActionLinkClassName} text-sm`}
                        />{" "}
                        <span className="tabular-nums">
                          {formatGHS(row.actual)} of {formatGHS(row.budgeted)} (+
                          {formatGHS(budgetOverAmount(row))})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="p-4" id="scorecard-budget-panel">
                <BudgetVsActualTable snapshot={snapshot} budgetTotals={budgetTotals} />
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-8 rounded-lg border border-slate-200">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-base font-semibold text-[#0f2744]">
              Ready to pay a dividend?
            </h3>
            <div
              className={`rounded-md border px-4 py-3 text-sm font-medium ${
                snapshot.checklist.ready
                  ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                  : "border-amber-200 bg-amber-50 text-amber-950"
              }`}
            >
              {checklistBannerText}
            </div>
          </div>
          <button
            type="button"
            className={scorecardSectionToggleClassName}
            aria-expanded={checklistOpen}
            aria-controls="scorecard-checklist-panel"
            onClick={toggleChecklistOpen}
          >
            {checklistOpen ? "Hide checks ▾" : "Show all checks ▸"}
          </button>
        </div>

        {!checklistOpen ? (
          <div className="p-4" id="scorecard-checklist-panel">
            {collapsedChecklistItems.length === 0 ? (
              <p className="text-sm text-slate-500">No overdue checks.</p>
            ) : (
              <ul className="space-y-4">
                {collapsedChecklistItems.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4 p-4" id="scorecard-checklist-panel">
            <ul className="space-y-4">
              {snapshot.checklist.items.map((item) => (
                <ChecklistItemRow key={item.id} item={item} />
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              Rates used: CIT {(DIRECTOR_SCORECARD_CIT_RATE * 100).toFixed(0)}%, GSL{" "}
              {(DIRECTOR_SCORECARD_GSL_RATE * 100).toFixed(1)}%, dividend WHT{" "}
              {(DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE * 100).toFixed(0)}%. Planning
              figures, not tax advice.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
