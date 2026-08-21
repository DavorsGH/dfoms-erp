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
import PortalComplaintActions from "./complaint-actions";
import PortalComplaintAcknowledge from "./complaint-acknowledge";

export type PortalComplaintListItem = {
  complaintId: string;
  subject: string;
  description: string;
  raisedBy: "tenant" | "landlord";
  raisedByLabel: string;
  dateLabel: string;
  statusLabel: string;
  staffResponse: string | null;
  tenantAcknowledgedAt: string | null;
  isOpen: boolean;
  needsAcknowledgment: boolean;
};

type PortalComplaintsListProps = {
  rows: PortalComplaintListItem[];
};

const actionLinkClassName =
  "text-sm font-medium text-[#0f2744] hover:underline disabled:cursor-not-allowed disabled:opacity-50";

const fromBadgeClassName =
  "inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600";

function statusDetailLabel(row: PortalComplaintListItem): string | null {
  if (row.tenantAcknowledgedAt) {
    return "Acknowledged";
  }
  if (row.needsAcknowledgment) {
    return "Awaiting your acknowledgment";
  }
  return null;
}

function ComplaintExpandedPanel({
  row,
  canRespond,
  isExpanded,
  needsAcknowledgment,
  isTenantRaised,
}: {
  row: PortalComplaintListItem;
  canRespond: boolean;
  isExpanded: boolean;
  needsAcknowledgment: boolean;
  isTenantRaised: boolean;
}) {
  const showRespondForm = canRespond && isExpanded;
  const showAcknowledgeForm = needsAcknowledgment;
  const showAcknowledgedNote =
    isTenantRaised && Boolean(row.tenantAcknowledgedAt);

  if (!showRespondForm && !showAcknowledgeForm && !showAcknowledgedNote) {
    return null;
  }

  return (
    <div className="space-y-3">
      {showRespondForm ? (
        <PortalComplaintActions
          complaintId={row.complaintId}
          initialResponse={row.staffResponse}
        />
      ) : null}

      {showAcknowledgeForm ? (
        <PortalComplaintAcknowledge
          complaintId={row.complaintId}
          acknowledgedAt={row.tenantAcknowledgedAt}
        />
      ) : null}

      {showAcknowledgedNote && !showAcknowledgeForm ? (
        <PortalComplaintAcknowledge
          complaintId={row.complaintId}
          acknowledgedAt={row.tenantAcknowledgedAt}
        />
      ) : null}
    </div>
  );
}

function SubjectDescriptionCell({
  row,
  isTenantRaised,
  isLandlordRaised,
  canRespond,
  isExpanded,
}: {
  row: PortalComplaintListItem;
  isTenantRaised: boolean;
  isLandlordRaised: boolean;
  canRespond: boolean;
  isExpanded: boolean;
}) {
  const showResponsePreview =
    row.staffResponse && !(canRespond && isExpanded);

  return (
    <div className="min-w-[12rem] max-w-xl space-y-1">
      <p className="font-medium text-[#0f2744]">{row.subject}</p>
      <p className="text-sm text-slate-700">
        {isTenantRaised ? (
          <span className="text-slate-500">Your report: </span>
        ) : null}
        {row.description}
      </p>
      {showResponsePreview ? (
        <p className="text-sm text-slate-600">
          {isLandlordRaised ? "Your response: " : "Landlord: "}
          {row.staffResponse}
        </p>
      ) : null}
    </div>
  );
}

function ComplaintActionControl({
  canRespond,
  isExpanded,
  needsAcknowledgment,
  onToggle,
}: {
  canRespond: boolean;
  isExpanded: boolean;
  needsAcknowledgment: boolean;
  onToggle: () => void;
}) {
  if (canRespond) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={actionLinkClassName}
        aria-expanded={isExpanded}
      >
        {isExpanded ? "Hide response" : "View & respond"}
      </button>
    );
  }

  if (needsAcknowledgment) {
    return (
      <span className="text-sm text-emerald-800">Acknowledge below</span>
    );
  }

  return <span className="text-sm text-slate-400">—</span>;
}

function getComplaintRowState(row: PortalComplaintListItem) {
  const isLandlordRaised = row.raisedBy === "landlord";
  const isTenantRaised = row.raisedBy === "tenant";
  const needsAcknowledgment = row.needsAcknowledgment === true;
  const canRespond = isLandlordRaised && row.isOpen;

  return {
    isLandlordRaised,
    isTenantRaised,
    needsAcknowledgment,
    canRespond,
  };
}

export default function PortalComplaintsList({ rows }: PortalComplaintsListProps) {
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
                <th className={scrollableTableHeadingClassName("Subject / Description")}>
                  Subject / Description
                </th>
                <th className={scrollableTableThClassName}>From</th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Action</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row, index) => {
                const {
                  isLandlordRaised,
                  isTenantRaised,
                  needsAcknowledgment,
                  canRespond,
                } = getComplaintRowState(row);
                const isExpanded = expandedIds.has(row.complaintId);
                const statusExtra = statusDetailLabel(row);
                const showDetailRow =
                  (canRespond && isExpanded) ||
                  needsAcknowledgment ||
                  (isTenantRaised && Boolean(row.tenantAcknowledgedAt));

                return (
                  <Fragment key={row.complaintId}>
                    <tr className={getStripedRowClassName(index)}>
                      <td className={scrollableTableWrapTdClassName}>
                        <SubjectDescriptionCell
                          row={row}
                          isTenantRaised={isTenantRaised}
                          isLandlordRaised={isLandlordRaised}
                          canRespond={canRespond}
                          isExpanded={isExpanded}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className={fromBadgeClassName}>
                          {row.raisedByLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.dateLabel}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-1">
                          <p className="text-slate-900">{row.statusLabel}</p>
                          {statusExtra ? (
                            <p className="text-xs text-slate-600">{statusExtra}</p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <ComplaintActionControl
                          canRespond={canRespond}
                          isExpanded={isExpanded}
                          needsAcknowledgment={needsAcknowledgment}
                          onToggle={() => toggleExpanded(row.complaintId)}
                        />
                      </td>
                    </tr>
                    {showDetailRow ? (
                      <tr className="bg-slate-50">
                        <td colSpan={5} className="px-4 py-3">
                          <ComplaintExpandedPanel
                            row={row}
                            canRespond={canRespond}
                            isExpanded={isExpanded}
                            needsAcknowledgment={needsAcknowledgment}
                            isTenantRaised={isTenantRaised}
                          />
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
          const {
            isLandlordRaised,
            isTenantRaised,
            needsAcknowledgment,
            canRespond,
          } = getComplaintRowState(row);
          const isExpanded = expandedIds.has(row.complaintId);
          const statusExtra = statusDetailLabel(row);
          const showDetailPanel =
            (canRespond && isExpanded) ||
            needsAcknowledgment ||
            (isTenantRaised && Boolean(row.tenantAcknowledgedAt));

          return (
            <li key={row.complaintId} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={fromBadgeClassName}>{row.raisedByLabel}</span>
                <span className="text-xs text-slate-500">{row.dateLabel}</span>
              </div>

              <p className="mt-1 text-sm font-medium text-[#0f2744]">
                {row.subject}
              </p>

              <p className="mt-1 text-sm text-slate-700">
                {isTenantRaised ? (
                  <span className="text-slate-500">Your report: </span>
                ) : null}
                {row.description}
              </p>

              {row.staffResponse && !(canRespond && isExpanded) ? (
                <p className="mt-1 text-sm text-slate-600">
                  {isLandlordRaised ? "Your response: " : "Landlord: "}
                  {row.staffResponse}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-slate-900">{row.statusLabel}</p>
                  {statusExtra ? (
                    <p className="text-xs text-slate-600">{statusExtra}</p>
                  ) : null}
                </div>
                <ComplaintActionControl
                  canRespond={canRespond}
                  isExpanded={isExpanded}
                  needsAcknowledgment={needsAcknowledgment}
                  onToggle={() => toggleExpanded(row.complaintId)}
                />
              </div>

              {showDetailPanel ? (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <ComplaintExpandedPanel
                    row={row}
                    canRespond={canRespond}
                    isExpanded={isExpanded}
                    needsAcknowledgment={needsAcknowledgment}
                    isTenantRaised={isTenantRaised}
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
