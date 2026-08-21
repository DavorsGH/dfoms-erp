"use client";

import { Fragment, useCallback, useState } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import type { LesseeComplaintRaisedBy } from "@/app/dashboard/real-estate/complaints-utils";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableHeadingClassName,
} from "@/app/dashboard/scrollable-table";
import LandlordPortalComplaintActions from "./complaint-actions";

export type LandlordComplaintListItem = {
  complaintId: string;
  subject: string;
  description: string;
  status: string;
  statusLabel: string;
  raisedBy: LesseeComplaintRaisedBy;
  raisedByLabel: string;
  staffResponse: string | null;
  dateLabel: string;
  lesseeName: string;
  unitLabel: string;
  isOpen: boolean;
};

type LandlordComplaintsListProps = {
  rows: LandlordComplaintListItem[];
  canAct: boolean;
};

const actionLinkClassName =
  "text-sm font-medium text-[#0f2744] hover:underline disabled:cursor-not-allowed disabled:opacity-50";

const fromBadgeClassName =
  "inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600";

export default function LandlordComplaintsList({
  rows,
  canAct,
}: LandlordComplaintsListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const toggleExpanded = useCallback((complaintId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(complaintId)) {
        next.delete(complaintId);
      } else {
        next.add(complaintId);
      }
      return next;
    });
  }, []);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 min-w-0">
      <div className="hidden md:block">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableHeadingClassName("Subject")}>
                  Subject
                </th>
                <th className={scrollableTableThClassName}>Tenant / unit</th>
                <th className={scrollableTableThClassName}>From</th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Action</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row, index) => {
                const isTenantRaised = row.raisedBy === "tenant";
                const showActions = canAct && row.isOpen;
                const isExpanded = expandedIds.has(row.complaintId);

                return (
                  <Fragment key={row.complaintId}>
                    <tr className={getStripedRowClassName(index)}>
                      <td className={scrollableTableWrapTdClassName}>
                        <div className="min-w-[12rem] max-w-xl space-y-1">
                          <p className="font-medium text-[#0f2744]">
                            {row.subject}
                          </p>
                          {row.description && !(showActions && isExpanded) ? (
                            <p className="text-sm text-slate-600">
                              {row.description}
                            </p>
                          ) : null}
                          {row.staffResponse && !(showActions && isExpanded) ? (
                            <p className="text-sm text-slate-600">
                              {isTenantRaised
                                ? `Your response: ${row.staffResponse}`
                                : `Tenant response: ${row.staffResponse}`}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        <div className="space-y-0.5">
                          <p>{row.lesseeName}</p>
                          <p className="text-xs text-slate-500">
                            {row.unitLabel}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className={fromBadgeClassName}>
                          {row.raisedByLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.dateLabel}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-900">
                        {row.statusLabel}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        {showActions ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(row.complaintId)}
                            className={actionLinkClassName}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "Hide" : "Review & respond"}
                          </button>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                    {showActions && isExpanded ? (
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="space-y-3">
                            {row.description ? (
                              <p className="text-sm text-slate-700">
                                {row.description}
                              </p>
                            ) : null}
                            {row.staffResponse ? (
                              <p className="text-sm text-slate-600">
                                {isTenantRaised
                                  ? `Your response: ${row.staffResponse}`
                                  : `Tenant response: ${row.staffResponse}`}
                              </p>
                            ) : null}
                            {showActions ? (
                              <LandlordPortalComplaintActions
                                complaintId={row.complaintId}
                                raisedBy={row.raisedBy}
                                initialStatus={row.status}
                                initialResponse={row.staffResponse}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </div>

      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-sm md:hidden">
        {rows.map((row) => {
          const isTenantRaised = row.raisedBy === "tenant";
          const showActions = canAct && row.isOpen;
          const isExpanded = expandedIds.has(row.complaintId);

          return (
            <li key={row.complaintId} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={fromBadgeClassName}>{row.raisedByLabel}</span>
                <span className="text-xs text-slate-500">{row.dateLabel}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-[#0f2744]">
                {row.subject}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {row.lesseeName} · {row.unitLabel}
              </p>
              {row.description && !(showActions && isExpanded) ? (
                <p className="mt-1 text-sm text-slate-600">{row.description}</p>
              ) : null}
              {row.staffResponse && !(showActions && isExpanded) ? (
                <p className="mt-1 text-sm text-slate-600">
                  {isTenantRaised
                    ? `Your response: ${row.staffResponse}`
                    : `Tenant response: ${row.staffResponse}`}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-900">{row.statusLabel}</p>
                {showActions ? (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(row.complaintId)}
                    className={actionLinkClassName}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "Hide" : "Review & respond"}
                  </button>
                ) : null}
              </div>
              {showActions && isExpanded ? (
                <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                  {row.description ? (
                    <p className="text-sm text-slate-700">{row.description}</p>
                  ) : null}
                  {row.staffResponse ? (
                    <p className="text-sm text-slate-600">
                      {isTenantRaised
                        ? `Your response: ${row.staffResponse}`
                        : `Tenant response: ${row.staffResponse}`}
                    </p>
                  ) : null}
                  <LandlordPortalComplaintActions
                    complaintId={row.complaintId}
                    raisedBy={row.raisedBy}
                    initialStatus={row.status}
                    initialResponse={row.staffResponse}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
