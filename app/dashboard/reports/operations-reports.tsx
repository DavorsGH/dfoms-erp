"use client";

import { useEffect, useMemo, useState } from "react";
import { getStripedRowClassName } from "../finance/register-row-actions";
import { inputClassName } from "../employees/employee-record-utils";
import type { CorrectiveActionEntry } from "../operations/corrective-actions-utils";
import type { ComplaintRegisterEntry } from "../operations/complaint-register-utils";
import type { ClientEntry } from "../operations/clients-utils";
import type {
  DutyRosterEmployee,
  DutyRosterProject,
  DutyRosterSite,
  RosterHistoryRecord,
} from "../operations/duty-roster-utils";
import type { RosterConfigRecord } from "../operations/roster-config-utils";
import type { FailedInspectionEntry } from "../operations/failed-inspections-utils";
import type { IncidentRegisterEntry } from "../operations/incident-register-utils";
import type { InspectionSummaryEntry } from "../operations/inspection-summary-utils";
import type { SiteEntry } from "../operations/sites-utils";
import type { WorkOrderEntry } from "../operations/work-orders-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatReportPeriodLabel,
  getDefaultReportMonthYear,
} from "./finance-reports-utils";
import {
  buildClientServiceReport,
  buildCorrectiveActionStatusReport,
  buildEscalatedIncidentsReport,
  buildMonthlyIncidentSummaryReport,
  buildQualityKpiSummaryReport,
  buildRecurringIssueTrendReport,
  buildSitePerformanceReport,
  formatTrendIndicator,
  getIndividualIncidentReport,
  type TrendDirection,
} from "./operations-reports-utils";
import {
  FINANCE_REPORT_PRINT_AREA_ID,
  REPORT_COMPANY_NAME,
  ReportActionBar,
  ReportCompanyHeader,
  ReportMonthYearSelector,
  ReportPrintStyles,
  downloadCsv,
  formatReportDate,
} from "./report-ui";

type FetchErrorProps = {
  fetchError: string | null;
  incidentFetchError?: string | null;
};

function ReportFetchError({ fetchError, incidentFetchError }: FetchErrorProps) {
  if (!fetchError && !incidentFetchError) {
    return null;
  }

  return (
    <>
      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}
      {incidentFetchError ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Incident register could not be loaded: {incidentFetchError}. Incident
          counts may show as zero until the register is available.
        </p>
      ) : null}
    </>
  );
}

function useMonthYearSelection(availableYears: number[]) {
  const defaults = getDefaultReportMonthYear();
  const [year, setYear] = useState(
    availableYears.includes(defaults.year)
      ? defaults.year
      : (availableYears[0] ?? defaults.year),
  );
  const [month, setMonth] = useState(defaults.month);
  const periodLabel = formatReportPeriodLabel(year, month);

  return {
    year,
    month,
    setYear,
    setMonth,
    periodLabel,
  };
}

function handleReportPrint() {
  window.print();
}

function ReportPanel({
  title,
  periodLabel,
  children,
  className = "",
}: {
  title: string;
  periodLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      id={FINANCE_REPORT_PRINT_AREA_ID}
      className={`rounded-lg border border-slate-200 bg-white p-6 shadow-sm ${className}`}
    >
      <ReportCompanyHeader title={title} periodLabel={periodLabel} />
      {children}
    </div>
  );
}

function TrendIndicator({
  trend,
  current,
  prior,
}: {
  trend: TrendDirection;
  current: number | null;
  prior: number | null;
}) {
  if (current === null) {
    return <span className="text-slate-400">—</span>;
  }

  const colorClass =
    trend === "up"
      ? "text-emerald-700"
      : trend === "down"
        ? "text-red-700"
        : "text-slate-600";

  return (
    <span className={`inline-flex items-center gap-1 font-medium ${colorClass}`}>
      <span aria-hidden>{formatTrendIndicator(trend)}</span>
      <span>{current.toFixed(1)}%</span>
      {prior !== null ? (
        <span className="text-xs font-normal text-slate-500">
          (prev {prior.toFixed(1)}%)
        </span>
      ) : null}
    </span>
  );
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatCount(value: number): string {
  return String(value);
}

function ReportClientFilter({
  clients,
  value,
  onChange,
  includeAllOption = true,
  allOptionLabel = "All Clients",
  placeholder = "Select client",
}: {
  clients: ClientEntry[];
  value: string;
  onChange: (clientId: string) => void;
  includeAllOption?: boolean;
  allOptionLabel?: string;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={inputClassName}
      aria-label="Client filter"
    >
      {includeAllOption ? (
        <option value="">{allOptionLabel}</option>
      ) : (
        <option value="">{placeholder}</option>
      )}
      {clients.map((client) => (
        <option key={client.client_id} value={client.client_id}>
          {client.client_name}
        </option>
      ))}
    </select>
  );
}

export function QualityKpiSummaryReport({
  initialInspections,
  initialSites,
  initialClients,
  availableYears,
  fetchError,
  scopedClientId = null,
}: {
  initialInspections: InspectionSummaryEntry[];
  initialSites: SiteEntry[];
  initialClients: ClientEntry[];
  availableYears: number[];
  fetchError: string | null;
  scopedClientId?: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);
  const [selectedClientId, setSelectedClientId] = useState(
    scopedClientId ?? "",
  );

  useEffect(() => {
    if (scopedClientId) {
      setSelectedClientId(scopedClientId);
    }
  }, [scopedClientId]);

  const activeClientId = (scopedClientId ?? selectedClientId) || null;
  const report = useMemo(
    () =>
      buildQualityKpiSummaryReport(
        initialInspections,
        initialSites,
        year,
        month,
        activeClientId,
      ),
    [initialInspections, initialSites, year, month, activeClientId],
  );

  const handleExport = () => {
    downloadCsv(
      `quality-kpi-summary-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        "Client",
        "Site Name",
        "Inspections",
        "Avg Score %",
        "Pass Count",
        "Fail Count",
        "Pass Rate %",
        "Trend vs Prior Month",
      ],
      [
        ...report.rows.map((row) => [
          row.clientName,
          row.siteName,
          row.inspectionCount,
          row.averageScorePct,
          row.passCount,
          row.failCount,
          row.passRatePct,
          formatTrendIndicator(row.scoreTrend),
        ]),
        [
          "Company Total",
          "",
          report.totals.inspectionCount,
          report.totals.averageScorePct,
          report.totals.passCount,
          report.totals.failCount,
          report.totals.passRatePct,
          formatTrendIndicator(report.totals.scoreTrend),
        ],
      ],
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport}>
        {!scopedClientId ? (
          <ReportClientFilter
            clients={initialClients}
            value={selectedClientId}
            onChange={setSelectedClientId}
          />
        ) : null}
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportPanel title="Quality KPI Summary" periodLabel={periodLabel}>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {[
                  "Client",
                  "Site Name",
                  "Inspections",
                  "Avg Score %",
                  "Pass",
                  "Fail",
                  "Pass Rate %",
                  "Score Trend",
                ].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row, index) => (
                <tr key={row.siteId} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm text-slate-800">{row.clientName}</td>
                  <td className="px-4 py-3 text-sm text-slate-800">{row.siteName}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatCount(row.inspectionCount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    <TrendIndicator
                      trend={row.scoreTrend}
                      current={row.averageScorePct}
                      prior={row.priorMonthAverageScorePct}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{row.passCount}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{row.failCount}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatPct(row.passRatePct)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatTrendIndicator(row.scoreTrend)}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-semibold">
                <td className="px-4 py-3 text-sm text-slate-900">Company Total</td>
                <td className="px-4 py-3 text-sm text-slate-900" />
                <td className="px-4 py-3 text-sm text-slate-900">
                  {report.totals.inspectionCount}
                </td>
                <td className="px-4 py-3 text-sm text-slate-900">
                  <TrendIndicator
                    trend={report.totals.scoreTrend}
                    current={report.totals.averageScorePct}
                    prior={report.totals.priorMonthAverageScorePct}
                  />
                </td>
                <td className="px-4 py-3 text-sm text-slate-900">
                  {report.totals.passCount}
                </td>
                <td className="px-4 py-3 text-sm text-slate-900">
                  {report.totals.failCount}
                </td>
                <td className="px-4 py-3 text-sm text-slate-900">
                  {formatPct(report.totals.passRatePct)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-900">
                  {formatTrendIndicator(report.totals.scoreTrend)}
                </td>
              </tr>
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function SitePerformanceReport({
  initialInspections,
  initialFailedInspections,
  initialComplaints,
  initialIncidents,
  initialSites,
  initialClients,
  availableYears,
  fetchError,
  incidentFetchError,
  scopedClientId = null,
}: {
  initialInspections: InspectionSummaryEntry[];
  initialFailedInspections: FailedInspectionEntry[];
  initialComplaints: ComplaintRegisterEntry[];
  initialIncidents: IncidentRegisterEntry[];
  initialSites: SiteEntry[];
  initialClients: ClientEntry[];
  availableYears: number[];
  fetchError: string | null;
  incidentFetchError?: string | null;
  scopedClientId?: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);
  const [selectedClientId, setSelectedClientId] = useState(
    scopedClientId ?? "",
  );

  useEffect(() => {
    if (scopedClientId) {
      setSelectedClientId(scopedClientId);
    }
  }, [scopedClientId]);

  const activeClientId = (scopedClientId ?? selectedClientId) || null;
  const rows = useMemo(
    () =>
      buildSitePerformanceReport(
        initialInspections,
        initialFailedInspections,
        initialComplaints,
        initialIncidents,
        initialSites,
        year,
        month,
        activeClientId,
      ),
    [
      initialInspections,
      initialFailedInspections,
      initialComplaints,
      initialIncidents,
      initialSites,
      year,
      month,
      activeClientId,
    ],
  );

  const handleExport = () => {
    downloadCsv(
      `site-performance-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        "Client",
        "Site Name",
        "Avg Inspection Score %",
        "Open Failed Inspections",
        "Complaints Received",
        "Incidents Logged",
      ],
      rows.map((row) => [
        row.clientName,
        row.siteName,
        row.averageInspectionScorePct,
        row.openFailedInspections,
        row.complaintsReceived,
        row.incidentsLogged,
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError
        fetchError={fetchError}
        incidentFetchError={incidentFetchError}
      />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport}>
        {!scopedClientId ? (
          <ReportClientFilter
            clients={initialClients}
            value={selectedClientId}
            onChange={setSelectedClientId}
          />
        ) : null}
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportPanel title="Site Performance Report" periodLabel={periodLabel}>
        <p className="mb-4 text-sm text-slate-600">
          Sorted by worst-performing first (lowest inspection score and highest
          issue counts).
        </p>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {[
                  "Client",
                  "Site Name",
                  "Avg Inspection Score %",
                  "Open Failed Inspections",
                  "Complaints",
                  "Incidents",
                ].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.siteId} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm text-slate-800">
                    {row.clientName}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">
                    {row.siteName}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatPct(row.averageInspectionScorePct)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.openFailedInspections}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.complaintsReceived}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.incidentsLogged}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function CorrectiveActionStatusReport({
  initialCorrectiveActions,
  fetchError,
}: {
  initialCorrectiveActions: CorrectiveActionEntry[];
  fetchError: string | null;
}) {
  const report = useMemo(
    () => buildCorrectiveActionStatusReport(initialCorrectiveActions),
    [initialCorrectiveActions],
  );

  const handleExport = () => {
    downloadCsv(
      "corrective-action-status.csv",
      [
        "Action No",
        "Client",
        "Issue Description",
        "Responsible Person",
        "Target Date",
        "Status",
        "Days Open",
        "Overdue",
        "Group Status",
      ],
      report.rows.map((row) => [
        row.actionNo,
        row.clientName,
        row.issueDescription,
        row.responsiblePerson,
        row.targetDate,
        row.status,
        row.daysOpen,
        row.isOverdue ? "Yes" : "No",
        row.groupStatus,
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport} />
      <ReportPanel
        title="Corrective Action Status"
        periodLabel="All records"
      >
        <div className="mb-4 flex flex-wrap gap-3">
          {report.groups.map((group) => (
            <span
              key={group.status}
              className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
            >
              {group.status}: {group.count}
            </span>
          ))}
        </div>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {[
                  "Action No",
                  "Client",
                  "Issue Description",
                  "Responsible Person",
                  "Target Date",
                  "Status",
                  "Days Open",
                  "Overdue",
                ].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row, index) => (
                <tr
                  key={row.actionNo}
                  className={`${getStripedRowClassName(index)} ${
                    row.isOverdue ? "bg-red-50" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-sm text-slate-800">{row.actionNo}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{row.clientName}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.issueDescription}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.responsiblePerson}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatReportDate(row.targetDate)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{row.status}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.daysOpen ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-red-700">
                    {row.isOverdue ? "Yes" : "No"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

function ClientReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 break-inside-avoid">
      <h4 className="mb-3 border-b border-slate-300 pb-2 text-sm font-bold uppercase tracking-wide text-[#0f2744]">
        {title}
      </h4>
      {children}
    </section>
  );
}

export function MonthlyClientServiceReport({
  initialClients,
  initialSites,
  initialInspections,
  initialWorkOrders,
  initialIncidents,
  initialComplaints,
  initialCorrectiveActions,
  rosterConfigs,
  rosterEmployees,
  rosterProjects,
  rosterSites,
  rosterHistory,
  availableYears,
  fetchError,
  incidentFetchError,
  scopedClientId = null,
}: {
  initialClients: ClientEntry[];
  initialSites: SiteEntry[];
  initialInspections: InspectionSummaryEntry[];
  initialWorkOrders: WorkOrderEntry[];
  initialIncidents: IncidentRegisterEntry[];
  initialComplaints: ComplaintRegisterEntry[];
  initialCorrectiveActions: CorrectiveActionEntry[];
  rosterConfigs: RosterConfigRecord[];
  rosterEmployees: DutyRosterEmployee[];
  rosterProjects: DutyRosterProject[];
  rosterSites: DutyRosterSite[];
  rosterHistory: RosterHistoryRecord[];
  availableYears: number[];
  fetchError: string | null;
  incidentFetchError?: string | null;
  scopedClientId?: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);
  const [selectedClientId, setSelectedClientId] = useState(
    scopedClientId ?? "",
  );

  useEffect(() => {
    if (scopedClientId) {
      setSelectedClientId(scopedClientId);
    }
  }, [scopedClientId]);

  const client = useMemo(
    () =>
      initialClients.find(
        (entry) => entry.client_id === (scopedClientId ?? selectedClientId),
      ) ?? null,
    [initialClients, scopedClientId, selectedClientId],
  );

  const report = useMemo(() => {
    if (!client) {
      return null;
    }

    return buildClientServiceReport({
      client,
      sites: initialSites,
      inspections: initialInspections,
      workOrders: initialWorkOrders,
      incidents: initialIncidents,
      complaints: initialComplaints,
      correctiveActions: initialCorrectiveActions,
      rosterConfigs,
      rosterEmployees,
      rosterProjects,
      rosterSites,
      rosterHistory,
      year,
      month,
    });
  }, [
    client,
    initialSites,
    initialInspections,
    initialWorkOrders,
    initialIncidents,
    initialComplaints,
    initialCorrectiveActions,
    rosterConfigs,
    rosterEmployees,
    rosterProjects,
    rosterSites,
    rosterHistory,
    year,
    month,
  ]);

  const handleExport = () => {
    if (!report || !client) {
      return;
    }

    downloadCsv(
      `client-service-report-${client.client_id}-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Section", "Detail"],
      [
        ["Client", client.client_name],
        ["Contract Period", report.executiveSummary.contractPeriod],
        [
          "Sites Covered",
          report.executiveSummary.sitesCovered.join("; "),
        ],
        [
          "Overall Avg Inspection Score %",
          report.executiveSummary.overallAverageInspectionScore,
        ],
        [
          "Work Orders Completed",
          report.executiveSummary.totalWorkOrdersCompleted,
        ],
      ],
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError
        fetchError={fetchError}
        incidentFetchError={incidentFetchError}
      />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={handleExport}
        exportDisabled={!report}
      >
        {!scopedClientId ? (
          <ReportClientFilter
            clients={initialClients}
            value={selectedClientId}
            onChange={setSelectedClientId}
            includeAllOption={false}
            placeholder="Select client"
          />
        ) : null}
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>

      {!client ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
          Select a client to generate this report.
        </p>
      ) : null}

      {report ? (
        <div
          id={FINANCE_REPORT_PRINT_AREA_ID}
          className="rounded-lg border border-slate-300 bg-white p-8 shadow-sm"
        >
          <header className="mb-8 border-b-2 border-[#0f2744] pb-6 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="Davors Facilities logo"
              className="mx-auto mb-4 h-20 w-20 rounded-md object-cover"
            />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Service Performance Report
            </p>
            <h3 className="mt-2 text-2xl font-bold text-[#0f2744]">
              {REPORT_COMPANY_NAME}
            </h3>
            <p className="mt-3 text-lg font-semibold text-slate-800">
              {report.client.client_name}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Reporting Period: {periodLabel}
            </p>
          </header>

          <ClientReportSection title="Executive Summary">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  Contract Period
                </dt>
                <dd className="text-sm text-slate-800">
                  {report.executiveSummary.contractPeriod}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  Overall Avg Inspection Score
                </dt>
                <dd className="text-sm text-slate-800">
                  {formatPct(report.executiveSummary.overallAverageInspectionScore)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  Work Orders Completed
                </dt>
                <dd className="text-sm text-slate-800">
                  {report.executiveSummary.totalWorkOrdersCompleted}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  Sites Covered
                </dt>
                <dd className="text-sm text-slate-800">
                  {report.executiveSummary.sitesCovered.length > 0
                    ? report.executiveSummary.sitesCovered.join(", ")
                    : "—"}
                </dd>
              </div>
            </dl>
          </ClientReportSection>

          <ClientReportSection title="Site-by-Site Inspection Results">
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    {[
                      "Site",
                      "Inspections",
                      "Avg Score %",
                      "Pass",
                      "Fail",
                      "Pass Rate %",
                    ].map((heading) => (
                      <th key={heading} className={scrollableTableThClassName}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.qualityRows.map((row, index) => (
                    <tr key={row.siteId} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-2 text-sm">{row.siteName}</td>
                      <td className="px-4 py-2 text-sm">{row.inspectionCount}</td>
                      <td className="px-4 py-2 text-sm">
                        {formatPct(row.averageScorePct)}
                      </td>
                      <td className="px-4 py-2 text-sm">{row.passCount}</td>
                      <td className="px-4 py-2 text-sm">{row.failCount}</td>
                      <td className="px-4 py-2 text-sm">
                        {formatPct(row.passRatePct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </ClientReportSection>

          <ClientReportSection title="Work Orders Completed">
            {report.workOrdersBySite.length === 0 ? (
              <p className="text-sm text-slate-600">No completed work orders this month.</p>
            ) : (
              <ul className="space-y-2 text-sm text-slate-800">
                {report.workOrdersBySite.map((row) => (
                  <li key={row.siteName}>
                    <span className="font-medium">{row.siteName}</span>: {row.count}{" "}
                    completed — {row.summary}
                  </li>
                ))}
              </ul>
            )}
          </ClientReportSection>

          <ClientReportSection title="Staffing Coverage">
            <p className="mb-3 text-sm text-slate-600">
              Duty roster rotation: {report.staffingRotationLabel}
            </p>
            {report.staffingRows.length === 0 ? (
              <p className="text-sm text-slate-600">
                No staffing data available for this client&apos;s sites.
              </p>
            ) : (
              <ScrollableTable>
                <table className={scrollableTableClassName}>
                  <thead className={scrollableTableHeadClassName}>
                    <tr>
                      {["Site / Facility", "Required Staff", "Actual Staff"].map(
                        (heading) => (
                          <th key={heading} className={scrollableTableThClassName}>
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {report.staffingRows.map((row, index) => (
                      <tr
                        key={row.siteCode}
                        className={`${getStripedRowClassName(index)} ${
                          row.isStaffingMismatch ? "bg-amber-50" : ""
                        }`}
                      >
                        <td className="px-4 py-2 text-sm">{row.facilityName}</td>
                        <td className="px-4 py-2 text-sm">{row.requiredStaff}</td>
                        <td className="px-4 py-2 text-sm">{row.totalStaff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            )}
          </ClientReportSection>

          <ClientReportSection title="Incidents Logged & Status">
            {report.incidents.length === 0 ? (
              <p className="text-sm text-slate-600">No incidents logged this month.</p>
            ) : (
              <ScrollableTable>
                <table className={scrollableTableClassName}>
                  <thead className={scrollableTableHeadClassName}>
                    <tr>
                      {["Date", "Site", "Type", "Description", "Status", "Resolved"].map(
                        (heading) => (
                          <th key={heading} className={scrollableTableThClassName}>
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {report.incidents.map((row, index) => (
                      <tr key={`${row.date}-${index}`} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-2 text-sm">{formatReportDate(row.date)}</td>
                        <td className="px-4 py-2 text-sm">{row.siteName}</td>
                        <td className="px-4 py-2 text-sm">{row.type}</td>
                        <td className="px-4 py-2 text-sm">{row.description}</td>
                        <td className="px-4 py-2 text-sm">{row.status}</td>
                        <td className="px-4 py-2 text-sm">
                          {formatReportDate(row.dateResolved)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            )}
          </ClientReportSection>

          <ClientReportSection title="Complaints Received & Resolution">
            {report.complaints.length === 0 ? (
              <p className="text-sm text-slate-600">No complaints received this month.</p>
            ) : (
              <ScrollableTable>
                <table className={scrollableTableClassName}>
                  <thead className={scrollableTableHeadClassName}>
                    <tr>
                      {[
                        "Date Received",
                        "Site",
                        "Details",
                        "Status",
                        "Resolution Date",
                        "Response (days)",
                      ].map((heading) => (
                        <th key={heading} className={scrollableTableThClassName}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.complaints.map((row, index) => (
                      <tr
                        key={`${row.dateReceived}-${index}`}
                        className={getStripedRowClassName(index)}
                      >
                        <td className="px-4 py-2 text-sm">
                          {formatReportDate(row.dateReceived)}
                        </td>
                        <td className="px-4 py-2 text-sm">{row.siteName}</td>
                        <td className="px-4 py-2 text-sm">{row.details}</td>
                        <td className="px-4 py-2 text-sm">{row.status}</td>
                        <td className="px-4 py-2 text-sm">
                          {formatReportDate(row.resolutionDate)}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {row.responseDays ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            )}
          </ClientReportSection>

          <ClientReportSection title="Corrective Actions Taken">
            {report.correctiveActions.length === 0 ? (
              <p className="text-sm text-slate-600">
                No corrective actions recorded this month.
              </p>
            ) : (
              <ScrollableTable>
                <table className={scrollableTableClassName}>
                  <thead className={scrollableTableHeadClassName}>
                    <tr>
                      {["Issue", "Action Taken", "Status"].map((heading) => (
                        <th key={heading} className={scrollableTableThClassName}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.correctiveActions.map((row, index) => (
                      <tr key={`${row.issue}-${index}`} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-2 text-sm">{row.issue}</td>
                        <td className="px-4 py-2 text-sm">{row.actionTaken}</td>
                        <td className="px-4 py-2 text-sm">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            )}
          </ClientReportSection>

          <footer className="mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
            Prepared by {REPORT_COMPANY_NAME} · Confidential client service report
          </footer>
        </div>
      ) : null}
    </div>
  );
}

export function IndividualIncidentReport({
  initialIncidents,
  fetchError,
}: {
  initialIncidents: IncidentRegisterEntry[];
  fetchError: string | null;
}) {
  const incidentOptions = useMemo(
    () =>
      [...initialIncidents]
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((row) => row.incident_no),
    [initialIncidents],
  );
  const [incidentNo, setIncidentNo] = useState(incidentOptions[0] ?? "");
  const report = useMemo(
    () => getIndividualIncidentReport(initialIncidents, incidentNo),
    [initialIncidents, incidentNo],
  );

  const handleExport = () => {
    if (!report) {
      return;
    }

    downloadCsv(`incident-${report.incidentNo}.csv`, ["Field", "Value"], [
      ["Incident No", report.incidentNo],
      ["Date", report.date],
      ["Time", report.time],
      ["Client", report.clientName],
      ["Site", report.siteName],
      ["Area", report.area],
      ["Incident Type", report.incidentType],
      ["Description", report.description],
      ["Severity", report.severity],
      ["Reported By", report.reportedBy],
      ["Action Taken", report.actionTaken],
      ["Status", report.status],
      ["Date Resolved", report.dateResolved],
      ["Escalated to Management", report.escalatedToManagement],
      ["Notes", report.notes],
    ]);
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={handleExport}
        exportDisabled={!report}
      >
        <div className="min-w-[220px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Incident No
          </label>
          <select
            value={incidentNo}
            onChange={(event) => setIncidentNo(event.target.value)}
            className={inputClassName}
          >
            {incidentOptions.length === 0 ? (
              <option value="">No incidents available</option>
            ) : (
              incidentOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            )}
          </select>
        </div>
      </ReportActionBar>

      {report ? (
        <ReportPanel
          title={`Individual Incident Report — ${report.incidentNo}`}
          periodLabel={formatReportDate(report.date)}
          className="max-w-3xl"
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              ["Incident No", report.incidentNo],
              ["Date", formatReportDate(report.date)],
              ["Time", report.time ?? "—"],
              ["Client", report.clientName],
              ["Site", report.siteName],
              ["Area", report.area],
              ["Incident Type", report.incidentType],
              ["Severity", report.severity],
              ["Reported By", report.reportedBy],
              ["Status", report.status],
              ["Date Resolved", formatReportDate(report.dateResolved)],
              ["Escalated to Management", report.escalatedToManagement],
              ["Days Open", report.daysOpen ?? "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  {label}
                </dt>
                <dd className="text-sm text-slate-800">{value}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase text-slate-500">
                Description
              </dt>
              <dd className="text-sm text-slate-800">{report.description}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase text-slate-500">
                Action Taken
              </dt>
              <dd className="text-sm text-slate-800">{report.actionTaken}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase text-slate-500">
                Notes
              </dt>
              <dd className="text-sm text-slate-800">{report.notes}</dd>
            </div>
          </dl>
        </ReportPanel>
      ) : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Select an incident to view the report.
        </p>
      )}
    </div>
  );
}

export function MonthlyIncidentSummaryReport({
  initialIncidents,
  availableYears,
  fetchError,
}: {
  initialIncidents: IncidentRegisterEntry[];
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);
  const report = useMemo(
    () => buildMonthlyIncidentSummaryReport(initialIncidents, year, month),
    [initialIncidents, year, month],
  );

  const handleExport = () => {
    downloadCsv(
      `monthly-incident-summary-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        "Incident No",
        "Date",
        "Client",
        "Site",
        "Type",
        "Severity",
        "Status",
        "Description",
      ],
      report.rows.map((row) => [
        row.incidentNo,
        row.date,
        row.clientName,
        row.siteName,
        row.type,
        row.severity,
        row.status,
        row.description,
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport}>
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportPanel title="Monthly Incident Summary" periodLabel={periodLabel}>
        <div className="mb-4 flex flex-wrap gap-3">
          {report.statusCounts.map((item) => (
            <span
              key={item.status}
              className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
            >
              {item.status}: {item.count}
            </span>
          ))}
        </div>
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">By Type</h4>
            <ul className="space-y-1 text-sm text-slate-700">
              {report.typeCounts.map((item) => (
                <li key={item.type}>
                  {item.type}: {item.count}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">By Severity</h4>
            <ul className="space-y-1 text-sm text-slate-700">
              {report.severityCounts.map((item) => (
                <li key={item.severity}>
                  {item.severity}: {item.count}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {[
                  "Incident No",
                  "Date",
                  "Client",
                  "Site",
                  "Type",
                  "Severity",
                  "Status",
                  "Description",
                ].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row, index) => (
                <tr key={row.incidentNo} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm">{row.incidentNo}</td>
                  <td className="px-4 py-3 text-sm">{formatReportDate(row.date)}</td>
                  <td className="px-4 py-3 text-sm">{row.clientName}</td>
                  <td className="px-4 py-3 text-sm">{row.siteName}</td>
                  <td className="px-4 py-3 text-sm">{row.type}</td>
                  <td className="px-4 py-3 text-sm">{row.severity}</td>
                  <td className="px-4 py-3 text-sm">{row.status}</td>
                  <td className="px-4 py-3 text-sm">{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function EscalatedIncidentsReport({
  initialIncidents,
  fetchError,
}: {
  initialIncidents: IncidentRegisterEntry[];
  fetchError: string | null;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const rows = useMemo(
    () =>
      buildEscalatedIncidentsReport(
        initialIncidents,
        startDate || null,
        endDate || null,
      ),
    [initialIncidents, startDate, endDate],
  );

  const handleExport = () => {
    downloadCsv(
      "escalated-incidents.csv",
      [
        "Date",
        "Client",
        "Site",
        "Type",
        "Description",
        "Severity",
        "Status",
        "Action Taken",
        "Days Open",
      ],
      rows.map((row) => [
        row.date,
        row.clientName,
        row.siteName,
        row.type,
        row.description,
        row.severity,
        row.status,
        row.actionTaken,
        row.daysOpen,
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              From (optional)
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              To (optional)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className={inputClassName}
            />
          </div>
        </div>
      </ReportActionBar>
      <ReportPanel title="Escalated Incidents Report" periodLabel="All escalated">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {[
                  "Date",
                  "Client",
                  "Site",
                  "Type",
                  "Description",
                  "Severity",
                  "Status",
                  "Action Taken",
                  "Days Open",
                ].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.date}-${index}`} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm">{formatReportDate(row.date)}</td>
                  <td className="px-4 py-3 text-sm">{row.clientName}</td>
                  <td className="px-4 py-3 text-sm">{row.siteName}</td>
                  <td className="px-4 py-3 text-sm">{row.type}</td>
                  <td className="px-4 py-3 text-sm">{row.description}</td>
                  <td className="px-4 py-3 text-sm">{row.severity}</td>
                  <td className="px-4 py-3 text-sm">{row.status}</td>
                  <td className="px-4 py-3 text-sm">{row.actionTaken}</td>
                  <td className="px-4 py-3 text-sm">{row.daysOpen ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function RecurringIssueTrendReport({
  initialIncidents,
  initialComplaints,
  fetchError,
}: {
  initialIncidents: IncidentRegisterEntry[];
  initialComplaints: ComplaintRegisterEntry[];
  fetchError: string | null;
}) {
  const rows = useMemo(
    () => buildRecurringIssueTrendReport(initialIncidents, initialComplaints),
    [initialIncidents, initialComplaints],
  );

  const handleExport = () => {
    downloadCsv(
      "recurring-issue-trend.csv",
      ["Source", "Site", "Issue", "Count", "Recurring Issue"],
      rows.map((row) => [
        row.source,
        row.siteName,
        row.issueLabel,
        row.count,
        row.isRecurring ? "Yes" : "No",
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport} />
      <ReportPanel title="Recurring Issue / Trend Report" periodLabel="All records">
        <p className="mb-4 text-sm text-slate-600">
          Site and issue combinations with 3 or more occurrences are flagged as
          recurring issues.
        </p>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {["Source", "Site", "Issue", "Count", "Flag"].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={`${row.source}-${row.siteName}-${row.issueLabel}`}
                  className={`${getStripedRowClassName(index)} ${
                    row.isRecurring ? "bg-amber-50 font-medium" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-sm">{row.source}</td>
                  <td className="px-4 py-3 text-sm">{row.siteName}</td>
                  <td className="px-4 py-3 text-sm">{row.issueLabel}</td>
                  <td className="px-4 py-3 text-sm">{row.count}</td>
                  <td className="px-4 py-3 text-sm">
                    {row.isRecurring ? "Recurring Issue" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}
