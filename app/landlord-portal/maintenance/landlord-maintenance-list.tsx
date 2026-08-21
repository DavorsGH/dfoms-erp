"use client";

import { Fragment, useCallback, useState } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import MaintenanceBeforeAfterGallery from "@/app/dashboard/real-estate/maintenance-before-after-gallery";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableHeadingClassName,
} from "@/app/dashboard/scrollable-table";
import LandlordPortalMaintenanceActions from "./maintenance-actions";
import LandlordPortalMaintenanceCompletePanel from "./maintenance-complete-panel";

export type LandlordMaintenanceListItem = {
  requestId: string;
  description: string;
  dateLabel: string;
  statusLabel: string;
  landlordApprovalLabel: string;
  costSelfFixLabel: string | null;
  lesseeName: string;
  unitLabel: string;
  tenantSelfFix: boolean;
  proposedCostGhs: number | null;
  status: string;
  landlordApprovalStatus: string;
  photoUrls: string[];
  completionPhotoUrls: string[];
  hasPendingApproval: boolean;
  hasPhotos: boolean;
};

type LandlordMaintenanceListProps = {
  rows: LandlordMaintenanceListItem[];
  canAct: boolean;
  tenantId: string;
};

const actionLinkClassName =
  "text-sm font-medium text-[#0f2744] hover:underline disabled:cursor-not-allowed disabled:opacity-50";

function rowNeedsPanel(row: LandlordMaintenanceListItem, canAct: boolean): boolean {
  if (!canAct) {
    return row.hasPhotos;
  }

  return (
    row.hasPendingApproval ||
    row.hasPhotos ||
    row.landlordApprovalStatus === "approved"
  );
}

export default function LandlordMaintenanceList({
  rows,
  canAct,
  tenantId,
}: LandlordMaintenanceListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const toggleExpanded = useCallback((requestId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
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
                <th className={scrollableTableHeadingClassName("Description")}>
                  Description
                </th>
                <th className={scrollableTableThClassName}>Tenant / unit</th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Cost / self-fix</th>
                <th className={scrollableTableThClassName}>Action</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row, index) => {
                const needsPanel = rowNeedsPanel(row, canAct);
                const isExpanded = expandedIds.has(row.requestId);

                return (
                  <Fragment key={row.requestId}>
                    <tr className={getStripedRowClassName(index)}>
                      <td className={scrollableTableWrapTdClassName}>
                        <p className="min-w-[12rem] max-w-xl font-medium text-[#0f2744]">
                          {row.description}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        <div className="space-y-0.5">
                          <p>{row.lesseeName}</p>
                          <p className="text-xs text-slate-500">
                            {row.unitLabel}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.dateLabel}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-1">
                          <p className="text-slate-900">{row.statusLabel}</p>
                          <p className="text-xs text-slate-600">
                            Landlord: {row.landlordApprovalLabel}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.costSelfFixLabel ?? "—"}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        {needsPanel ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(row.requestId)}
                            className={actionLinkClassName}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded
                              ? "Hide"
                              : row.hasPhotos
                                ? "View photos"
                                : "Review"}
                          </button>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                    {needsPanel && isExpanded ? (
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="space-y-3">
                            {canAct && row.hasPendingApproval ? (
                              <LandlordPortalMaintenanceActions
                                requestId={row.requestId}
                                tenantSelfFix={row.tenantSelfFix}
                                proposedCostGhs={row.proposedCostGhs}
                              />
                            ) : null}
                            {canAct ? (
                              <LandlordPortalMaintenanceCompletePanel
                                requestId={row.requestId}
                                status={row.status}
                                landlordApprovalStatus={row.landlordApprovalStatus}
                              />
                            ) : null}
                            {row.hasPhotos ? (
                              <MaintenanceBeforeAfterGallery
                                submissionPhotoUrls={row.photoUrls}
                                completionPhotoUrls={row.completionPhotoUrls}
                                tenantId={tenantId}
                                compact
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
          const needsPanel = rowNeedsPanel(row, canAct);
          const isExpanded = expandedIds.has(row.requestId);

          return (
            <li key={row.requestId} className="px-4 py-3">
              <p className="text-xs text-slate-500">{row.dateLabel}</p>
              <p className="mt-1 text-sm font-medium text-[#0f2744]">
                {row.description}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {row.lesseeName} · {row.unitLabel}
              </p>
              <div className="mt-2 space-y-1">
                <p className="text-sm text-slate-900">{row.statusLabel}</p>
                <p className="text-xs text-slate-600">
                  Landlord: {row.landlordApprovalLabel}
                </p>
                {row.costSelfFixLabel ? (
                  <p className="text-xs text-slate-600">
                    {row.costSelfFixLabel}
                  </p>
                ) : null}
              </div>
              {needsPanel ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(row.requestId)}
                    className={actionLinkClassName}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded
                      ? "Hide"
                      : row.hasPhotos
                        ? "View photos"
                        : "Review"}
                  </button>
                </div>
              ) : null}
              {needsPanel && isExpanded ? (
                <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                  {canAct && row.hasPendingApproval ? (
                    <LandlordPortalMaintenanceActions
                      requestId={row.requestId}
                      tenantSelfFix={row.tenantSelfFix}
                      proposedCostGhs={row.proposedCostGhs}
                    />
                  ) : null}
                  {canAct ? (
                    <LandlordPortalMaintenanceCompletePanel
                      requestId={row.requestId}
                      status={row.status}
                      landlordApprovalStatus={row.landlordApprovalStatus}
                    />
                  ) : null}
                  {row.hasPhotos ? (
                    <MaintenanceBeforeAfterGallery
                      submissionPhotoUrls={row.photoUrls}
                      completionPhotoUrls={row.completionPhotoUrls}
                      tenantId={tenantId}
                      compact
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}