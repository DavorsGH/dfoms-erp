"use client";

import { Fragment, useCallback, useState } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableHeadingClassName,
} from "@/app/dashboard/scrollable-table";
import LandlordPortalTerminationActions from "./termination-actions";

export type LandlordTerminationListItem = {
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  endDateLabel: string;
  statusLabel: string;
  reason: string | null;
  canReview: boolean;
};

type LandlordTerminationsListProps = {
  rows: LandlordTerminationListItem[];
};

const actionLinkClassName =
  "text-sm font-medium text-[#0f2744] hover:underline disabled:cursor-not-allowed disabled:opacity-50";

export default function LandlordTerminationsList({
  rows,
}: LandlordTerminationsListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const toggleExpanded = useCallback((leaseId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(leaseId)) {
        next.delete(leaseId);
      } else {
        next.add(leaseId);
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
                <th className={scrollableTableHeadingClassName("Tenant")}>
                  Tenant
                </th>
                <th className={scrollableTableThClassName}>Unit / lease end</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Action</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row, index) => {
                const isExpanded = expandedIds.has(row.leaseId);
                const showDetail = row.canReview && isExpanded;

                return (
                  <Fragment key={row.leaseId}>
                    <tr className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 align-top font-medium text-[#0f2744]">
                        {row.lesseeName}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        <div className="space-y-0.5">
                          <p>{row.unitLabel}</p>
                          <p className="text-xs text-slate-500">
                            Lease end {row.endDateLabel}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-900">
                        {row.statusLabel}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        {row.canReview ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(row.leaseId)}
                            className={actionLinkClassName}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "Hide" : "Review"}
                          </button>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                    {showDetail ? (
                      <tr className="bg-slate-50">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="space-y-3">
                            {row.reason ? (
                              <p className="text-sm text-slate-700">
                                {row.reason}
                              </p>
                            ) : null}
                            <LandlordPortalTerminationActions
                              leaseId={row.leaseId}
                            />
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
          const isExpanded = expandedIds.has(row.leaseId);

          return (
            <li key={row.leaseId} className="px-4 py-3">
              <p className="text-sm font-medium text-[#0f2744]">
                {row.lesseeName}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {row.unitLabel} · Lease end {row.endDateLabel}
              </p>
              <p className="mt-1 text-sm text-slate-900">{row.statusLabel}</p>
              {row.reason && !(row.canReview && isExpanded) ? (
                <p className="mt-1 text-sm text-slate-600">{row.reason}</p>
              ) : null}
              {row.canReview ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(row.leaseId)}
                    className={actionLinkClassName}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "Hide" : "Review"}
                  </button>
                </div>
              ) : null}
              {row.canReview && isExpanded ? (
                <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                  {row.reason ? (
                    <p className="text-sm text-slate-700">{row.reason}</p>
                  ) : null}
                  <LandlordPortalTerminationActions leaseId={row.leaseId} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
