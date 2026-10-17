"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { inputClassName } from "@/app/dashboard/employees/employee-record-utils";
import type { DashboardViewModel } from "@/app/dashboard/dashboard-utils";
import DirectorScorecardSection from "@/app/dashboard/director-scorecard-section";
import Dividends from "@/app/dashboard/finance/dividends";
import type {
  DividendDeclarationLineRow,
  DividendDeclarationRow,
  TenantShareholderRow,
} from "@/app/dashboard/finance/dividends-types";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";
import DirectorScorecardSettingsTab from "./director-scorecard-settings-tab";
import {
  DIRECTORS_BOARD_TABS,
  directorsBoardHref,
  parseDirectorsBoardTab,
  type DirectorsBoardTabId,
} from "./directors-nav-config";

type DirectorsBoardProps = {
  data: DashboardViewModel;
  fetchError: string | null;
  dividends: {
    tenantId: string;
    initialShareholders: TenantShareholderRow[];
    initialDeclarations: DividendDeclarationRow[];
    initialLines: DividendDeclarationLineRow[];
    fetchError: string | null;
  };
};

export default function DirectorsBoard({
  data,
  fetchError,
  dividends,
}: DirectorsBoardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseDirectorsBoardTab(searchParams.get("tab"));
  const monthFromUrl = searchParams.get("month")?.trim() ?? "";

  const defaultMonthKey = data.defaultMonthKey;
  const [selectedMonthKey, setSelectedMonthKey] = useState(
    monthFromUrl && data.monthOptions.some((m) => m.key === monthFromUrl)
      ? monthFromUrl
      : defaultMonthKey,
  );

  const scorecardMonthKey = selectedMonthKey;
  const directorScorecard =
    data.directorScorecardByMonthKey?.[scorecardMonthKey] ??
    data.directorScorecardByMonthKey?.[defaultMonthKey];

  const tabHref = useMemo(
    () => (tab: DirectorsBoardTabId) => directorsBoardHref(tab, selectedMonthKey),
    [selectedMonthKey],
  );

  function onMonthChange(nextKey: string) {
    setSelectedMonthKey(nextKey);
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", nextKey);
    if (activeTab === "scorecard") {
      params.delete("tab");
    }
    const q = params.toString();
    router.replace(q ? `/dashboard/directors?${q}` : "/dashboard/directors");
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#0f2744]">Directors</h1>
          <p className="mt-2 text-sm text-slate-600">
            Scorecard, dividends, and shareholder register for the business unit
            selected in the header.
          </p>
        </div>
        <div className="min-w-[220px]">
          <label
            htmlFor="directors-month"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Summary month
          </label>
          <select
            id="directors-month"
            className={inputClassName}
            value={selectedMonthKey}
            onChange={(event) => onMonthChange(event.target.value)}
          >
            {data.monthOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {fetchError}
        </p>
      ) : null}

      <nav className="border-b border-slate-200 pb-4">
        <ModuleNavTabStrip scrollKey={activeTab}>
          {DIRECTORS_BOARD_TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <Link
                key={tab.id}
                href={tabHref(tab.id)}
                {...moduleNavActiveTabProps(active)}
                className={`shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#0f2744] text-white"
                    : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </ModuleNavTabStrip>
      </nav>

      {activeTab === "scorecard" && directorScorecard ? (
        <DirectorScorecardSection
          snapshot={directorScorecard}
          monthKey={scorecardMonthKey}
          canManageSettings={false}
          hideSettingsButton
          initialSettings={data.directorScorecardSettings ?? null}
        />
      ) : null}

      {activeTab === "scorecard" && !directorScorecard ? (
        <p className="text-sm text-slate-600">No scorecard data for this month.</p>
      ) : null}

      {activeTab === "dividends" ? (
        <Dividends
          tenantId={dividends.tenantId}
          canManage
          initialShareholders={dividends.initialShareholders}
          initialDeclarations={dividends.initialDeclarations}
          initialLines={dividends.initialLines}
          fetchError={dividends.fetchError}
          viewMode="declarations"
        />
      ) : null}

      {activeTab === "shareholders" ? (
        <Dividends
          tenantId={dividends.tenantId}
          canManage
          initialShareholders={dividends.initialShareholders}
          initialDeclarations={dividends.initialDeclarations}
          initialLines={dividends.initialLines}
          fetchError={dividends.fetchError}
          viewMode="shareholders"
        />
      ) : null}

      {activeTab === "settings" ? (
        <DirectorScorecardSettingsTab
          initialSettings={data.directorScorecardSettings ?? null}
        />
      ) : null}
    </div>
  );
}
