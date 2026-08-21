"use client";

import Link from "next/link";
import { useState } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import { DetailTabs } from "@/app/dashboard/real-estate/lease-detail-layout";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableHeadingClassName,
} from "@/app/dashboard/scrollable-table";

export type PortalIssueItem = {
  id: string;
  kind: "repair" | "complaint";
  title: string;
  statusPrimary: string;
  statusSecondary: string | null;
  raisedByLabel: string | null;
  dateLabel: string;
  detail: string | null;
  isLandlordRaised: boolean;
  costSelfFixLabel: string | null;
  hasPhotos: boolean;
};

type PortalIssuesTabId = "complaints" | "repairs";

const PORTAL_ISSUES_TABS: ReadonlyArray<{
  id: PortalIssuesTabId;
  label: string;
}> = [
  { id: "complaints", label: "Complaints" },
  { id: "repairs", label: "Repairs" },
];

const DEFAULT_TAB: PortalIssuesTabId = "complaints";

const actionLinkClassName =
  "text-sm font-medium text-[#0f2744] hover:underline";

const fromBadgeClassName =
  "inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600";

function issueActionLabel(item: PortalIssueItem): string {
  if (item.kind === "repair") {
    return item.hasPhotos ? "View photos" : "View repair details";
  }

  if (item.isLandlordRaised) {
    return "View & respond";
  }

  if (item.statusSecondary === "Awaiting your acknowledgment") {
    return "Acknowledge resolution";
  }

  return "View complaint details";
}

function issueActionHref(item: PortalIssueItem): string {
  if (item.kind === "repair") {
    return `/portal/repairs/${item.id.replace(/^repair-/, "")}`;
  }

  return "/portal/complaints";
}

function ComplaintsIssueTable({ items }: { items: PortalIssueItem[] }) {
  return (
    <>
      <div className="hidden md:block">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableHeadingClassName("Subject")}>
                  Subject
                </th>
                <th className={scrollableTableThClassName}>From</th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Action</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {items.map((item, index) => (
                <tr key={item.id} className={getStripedRowClassName(index)}>
                  <td className={scrollableTableWrapTdClassName}>
                    <div className="min-w-[12rem] max-w-xl space-y-1">
                      <p className="font-medium text-[#0f2744]">{item.title}</p>
                      {item.detail ? (
                        <p className="text-sm text-slate-600">
                          {item.isLandlordRaised
                            ? `Your response: ${item.detail}`
                            : `Landlord: ${item.detail}`}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {item.raisedByLabel ? (
                      <span className={fromBadgeClassName}>
                        {item.raisedByLabel}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    {item.dateLabel}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <p className="text-slate-900">{item.statusPrimary}</p>
                      {item.statusSecondary ? (
                        <p className="text-xs text-slate-600">
                          {item.statusSecondary}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">
                    <Link href={issueActionHref(item)} className={actionLinkClassName}>
                      {issueActionLabel(item)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </div>

      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-sm md:hidden">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {item.raisedByLabel ? (
                <span className={fromBadgeClassName}>{item.raisedByLabel}</span>
              ) : null}
              <span className="text-xs text-slate-500">{item.dateLabel}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-[#0f2744]">{item.title}</p>
            {item.detail ? (
              <p className="mt-1 text-sm text-slate-600">
                {item.isLandlordRaised
                  ? `Your response: ${item.detail}`
                  : `Landlord: ${item.detail}`}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-slate-900">{item.statusPrimary}</p>
                {item.statusSecondary ? (
                  <p className="text-xs text-slate-600">{item.statusSecondary}</p>
                ) : null}
              </div>
              <Link href={issueActionHref(item)} className={actionLinkClassName}>
                {issueActionLabel(item)}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function RepairsIssueTable({ items }: { items: PortalIssueItem[] }) {
  return (
    <>
      <div className="hidden md:block">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableHeadingClassName("Description")}>
                  Description
                </th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Cost / self-fix</th>
                <th className={scrollableTableThClassName}>Action</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {items.map((item, index) => (
                <tr key={item.id} className={getStripedRowClassName(index)}>
                  <td className={scrollableTableWrapTdClassName}>
                    <p className="min-w-[12rem] max-w-xl font-medium text-[#0f2744]">
                      {item.title}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    {item.dateLabel}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <p className="text-slate-900">{item.statusPrimary}</p>
                      {item.statusSecondary ? (
                        <p className="text-xs text-slate-600">
                          {item.statusSecondary}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    {item.costSelfFixLabel ?? "—"}
                  </td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">
                    <Link href={issueActionHref(item)} className={actionLinkClassName}>
                      {issueActionLabel(item)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </div>

      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-sm md:hidden">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <p className="text-xs text-slate-500">{item.dateLabel}</p>
            <p className="mt-1 text-sm font-medium text-[#0f2744]">{item.title}</p>
            <div className="mt-2 space-y-1">
              <p className="text-sm text-slate-900">{item.statusPrimary}</p>
              {item.statusSecondary ? (
                <p className="text-xs text-slate-600">{item.statusSecondary}</p>
              ) : null}
              {item.costSelfFixLabel ? (
                <p className="text-xs text-slate-600">{item.costSelfFixLabel}</p>
              ) : null}
            </div>
            <div className="mt-2">
              <Link href={issueActionHref(item)} className={actionLinkClassName}>
                {issueActionLabel(item)}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function IssueList({
  items,
  emptyMessage,
  kind,
}: {
  items: PortalIssueItem[];
  emptyMessage: string;
  kind: PortalIssuesTabId;
}) {
  if (items.length === 0) {
    return <p className="py-2 text-sm text-slate-600">{emptyMessage}</p>;
  }

  return (
    <div className="min-w-0">
      {kind === "complaints" ? (
        <ComplaintsIssueTable items={items} />
      ) : (
        <RepairsIssueTable items={items} />
      )}
    </div>
  );
}

type PortalIssuesViewProps = {
  complaints: PortalIssueItem[];
  repairs: PortalIssueItem[];
};

export default function PortalIssuesView({
  complaints,
  repairs,
}: PortalIssuesViewProps) {
  const [activeTab, setActiveTab] = useState<PortalIssuesTabId>(DEFAULT_TAB);

  return (
    <div className="mt-3 space-y-3">
      <DetailTabs
        tabs={PORTAL_ISSUES_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === "complaints" ? (
        <IssueList
          kind="complaints"
          items={complaints}
          emptyMessage="No complaints yet. Submit one from the Complaints page."
        />
      ) : (
        <IssueList
          kind="repairs"
          items={repairs}
          emptyMessage="No repair requests yet. Submit one from the Repairs page."
        />
      )}
    </div>
  );
}
