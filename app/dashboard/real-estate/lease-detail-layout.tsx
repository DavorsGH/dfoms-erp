"use client";

import type { ReactNode } from "react";

export type LeaseDetailTabId = "overview" | "charges" | "documents" | "more";

export const LEASE_DETAIL_TABS: Array<{ id: LeaseDetailTabId; label: string }> =
  [
    { id: "overview", label: "Overview" },
    { id: "charges", label: "Charges" },
    { id: "documents", label: "Documents" },
    { id: "more", label: "More" },
  ];

export const leasePageClassName = "space-y-4";
export const leaseSectionClassName =
  "space-y-3 rounded-md border border-slate-200 bg-white p-3";
export const leaseSectionTitleClassName =
  "text-xs font-semibold uppercase tracking-wide text-[#0f2744]";
export const leaseFieldGridClassName =
  "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
export const leaseSummaryGridClassName =
  "grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 text-sm";

type LeaseDetailTabsProps = {
  activeTab: LeaseDetailTabId;
  onTabChange: (tab: LeaseDetailTabId) => void;
};

export function LeaseDetailTabs({
  activeTab,
  onTabChange,
}: LeaseDetailTabsProps) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-px">
      {LEASE_DETAIL_TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onTabChange(item.id)}
          className={`rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === item.id
              ? "border border-b-white border-slate-200 bg-white text-[#0f2744]"
              : "text-slate-600 hover:text-[#0f2744]"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

type LeaseSummaryItemProps = {
  label: string;
  value: ReactNode;
  className?: string;
};

export function LeaseSummaryItem({
  label,
  value,
  className,
}: LeaseSummaryItemProps) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-[#0f2744]">{value}</dd>
    </div>
  );
}

type LeaseDetailSectionProps = {
  title: string;
  id?: string;
  children: ReactNode;
  className?: string;
};

export function LeaseDetailSection({
  title,
  id,
  children,
  className,
}: LeaseDetailSectionProps) {
  return (
    <section id={id} className={`${leaseSectionClassName} ${className ?? ""}`}>
      <h3 className={leaseSectionTitleClassName}>{title}</h3>
      {children}
    </section>
  );
}
