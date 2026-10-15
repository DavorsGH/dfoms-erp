"use client";

import Link from "next/link";
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
  budgetHealthStatusLabel,
  sumBudgetVsActualTotals,
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

type DirectorScorecardSectionProps = {
  snapshot: DirectorScorecardSnapshot;
};

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

export default function DirectorScorecardSection({
  snapshot,
}: DirectorScorecardSectionProps) {
  const budgetTotals = sumBudgetVsActualTotals(snapshot.budget.rows);
  const reportHref = `/dashboard/reports/finance/budget-vs-actual?year=${snapshot.year}&month=${snapshot.month}`;
  const budgetHref = `/dashboard/finance/budget`;

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

      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-[#0f2744]">
            Budget vs actual ({snapshot.budget.periodLabel})
          </h3>
          <Link href={reportHref} className="text-sm font-medium text-[#0f2744] hover:underline">
            Open Budget vs Actual report
          </Link>
        </div>

        {!snapshot.budget.hasBudgetLines ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            No budget set for {snapshot.budget.periodLabel}.{" "}
            <Link href={budgetHref} className="font-medium text-[#0f2744] hover:underline">
              Set budget in Finance
            </Link>
            .
          </p>
        ) : (
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Line</th>
                  <th className={`${scrollableTableThClassName} text-right`}>
                    Budget
                  </th>
                  <th className={`${scrollableTableThClassName} text-right`}>
                    Actual
                  </th>
                  <th className={`${scrollableTableThClassName} text-right`}>
                    Variance
                  </th>
                  <th className={`${scrollableTableThClassName} text-right`}>
                    Variance %
                  </th>
                  <th className={`${scrollableTableThClassName} text-right`}>
                    Remaining
                  </th>
                  <th className={scrollableTableThClassName}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {snapshot.budget.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      No budget or actual activity for this month.
                    </td>
                  </tr>
                ) : (
                  snapshot.budget.rows.map((row, index) => (
                    <tr
                      key={row.rowKey}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm">
                        <Link
                          href={expenseRegisterHrefForBudgetLine({
                            year: snapshot.year,
                            month: snapshot.month,
                            category: row.category,
                            subcategory: row.subcategory,
                          })}
                          className="font-medium text-[#0f2744] underline decoration-slate-300 underline-offset-2 hover:decoration-[#0f2744] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f2744]"
                        >
                          {row.rowLabel}
                        </Link>
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
                          {budgetHealthStatusLabel(row.status)}
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
                          ? Math.round(
                              (budgetTotals.variance / budgetTotals.budgeted) *
                                10000,
                            ) / 100
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
        )}
      </div>

      <div className="mt-8">
        <h3 className="mb-3 text-base font-semibold text-[#0f2744]">
          Ready to pay a dividend?
        </h3>
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-sm font-medium ${
            snapshot.checklist.ready
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          {snapshot.checklist.ready
            ? "Ready — all checks complete. You can declare a dividend."
            : "Not yet — a few things to sort out first."}
        </div>
        <ul className="space-y-4">
          {snapshot.checklist.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3"
            >
              <ChecklistChip status={item.chipStatus} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm font-medium text-[#0f2744]">{item.label}</p>
                <ChecklistItemMessage item={item} />
                <ChecklistItemLinks item={item} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Rates used: CIT {(DIRECTOR_SCORECARD_CIT_RATE * 100).toFixed(0)}%, GSL{" "}
        {(DIRECTOR_SCORECARD_GSL_RATE * 100).toFixed(1)}%, dividend WHT{" "}
        {(DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE * 100).toFixed(0)}%. Planning
        figures, not tax advice.
      </p>
    </section>
  );
}
