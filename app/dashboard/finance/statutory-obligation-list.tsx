"use client";

import {
  OBLIGATION_KIND_LABELS,
  type StatutoryDueRuleKind,
  type StatutoryPeriodObligation,
} from "./statutory-due-rules";
import { formatDate, formatGHS, formatPeriodMonthLabel } from "./tax-ledger-utils";

export function StatutoryObligationList({
  obligations,
  kinds,
  emptyMessage,
}: {
  obligations: StatutoryPeriodObligation[];
  kinds?: StatutoryDueRuleKind[];
  emptyMessage?: string;
}) {
  const kindSet = kinds ? new Set(kinds) : null;
  const rows = obligations.filter((row) =>
    kindSet ? kindSet.has(row.kind) : true,
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        {emptyMessage ?? "No open statutory obligations for the current view."}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={`${row.kind}-${row.periodMonth}`}
          className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
        >
          <p className="text-sm font-medium text-slate-800">
            {OBLIGATION_KIND_LABELS[row.kind]} ·{" "}
            {formatPeriodMonthLabel(row.periodMonth)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Due {formatDate(row.dueDate)}
            {row.isOverdue ? (
              <span className="font-medium text-red-600">
                {" "}
                — {Math.abs(row.daysUntil)} day
                {Math.abs(row.daysUntil) === 1 ? "" : "s"} overdue
              </span>
            ) : row.daysUntil === 0 ? (
              <span className="font-medium text-amber-700"> — due today</span>
            ) : (
              <span className="text-slate-600">
                {" "}
                — in {row.daysUntil} day{row.daysUntil === 1 ? "" : "s"}
              </span>
            )}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            Open amount: {formatGHS(row.openAmount)}
          </p>
        </li>
      ))}
    </ul>
  );
}
