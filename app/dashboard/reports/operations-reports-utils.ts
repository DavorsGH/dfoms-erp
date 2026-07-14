import type { ClientEntry } from "../operations/clients-utils";
import {
  getCorrectiveActionClientName,
  isCorrectiveActionOverdue,
  type CorrectiveActionEntry,
} from "../operations/corrective-actions-utils";
import {
  buildDutyRosterViewModel,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "../operations/duty-roster-utils";
import type { FailedInspectionEntry } from "../operations/failed-inspections-utils";
import {
  getComplaintSiteName,
  type ComplaintRegisterEntry,
} from "../operations/complaint-register-utils";
import {
  getIncidentClientName,
  getIncidentReporterName,
  getIncidentSiteName,
  calculateIncidentDaysOpen,
  type IncidentRegisterEntry,
} from "../operations/incident-register-utils";
import {
  getInspectionSiteName,
  type InspectionSummaryEntry,
} from "../operations/inspection-summary-utils";
import {
  getPeriodEndDate,
  getPeriodStartDate,
} from "../hr-payroll/payroll-period-utils";
import type { SiteEntry } from "../operations/sites-utils";
import { getSiteClientName } from "../operations/sites-utils";
import {
  getWorkOrderSiteName,
  type WorkOrderEntry,
} from "../operations/work-orders-utils";
import {
  getRosterConfigForClient,
  type RosterConfigRecord,
} from "../operations/roster-config-utils";
import { formatReportPeriodLabel } from "./finance-reports-utils";

export type TrendDirection = "up" | "down" | "flat" | "none";

export type QualityKpiSiteRow = {
  siteId: string;
  siteName: string;
  clientName: string;
  inspectionCount: number;
  averageScorePct: number | null;
  passCount: number;
  failCount: number;
  passRatePct: number | null;
  scoreTrend: TrendDirection;
  priorMonthAverageScorePct: number | null;
};

export type QualityKpiReport = {
  periodLabel: string;
  rows: QualityKpiSiteRow[];
  totals: {
    inspectionCount: number;
    averageScorePct: number | null;
    passCount: number;
    failCount: number;
    passRatePct: number | null;
    scoreTrend: TrendDirection;
    priorMonthAverageScorePct: number | null;
  };
};

export type SitePerformanceRow = {
  siteId: string;
  siteName: string;
  clientName: string;
  averageInspectionScorePct: number | null;
  openFailedInspections: number;
  complaintsReceived: number;
  incidentsLogged: number;
  issueScore: number;
};

export type CorrectiveActionReportRow = {
  actionNo: string;
  clientName: string;
  issueDescription: string;
  responsiblePerson: string;
  targetDate: string | null;
  status: string;
  daysOpen: number | null;
  isOverdue: boolean;
  groupStatus: string;
};

export type CorrectiveActionStatusGroup = {
  status: string;
  count: number;
};

export type RecurringIssueRow = {
  source: "Incident" | "Complaint";
  siteName: string;
  issueLabel: string;
  count: number;
  isRecurring: boolean;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizePassFail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isDateInMonth(dateValue: string, year: number, month: number): boolean {
  const date = dateValue.slice(0, 10);
  return date >= getPeriodStartDate(year, month) && date <= getPeriodEndDate(year, month);
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function compareTrend(
  current: number | null,
  prior: number | null,
): TrendDirection {
  if (current === null || prior === null) {
    return "none";
  }

  if (current > prior + 0.05) {
    return "up";
  }

  if (current < prior - 0.05) {
    return "down";
  }

  return "flat";
}

function priorMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }

  return { year, month: month - 1 };
}

function buildSiteClientNameMap(sites: SiteEntry[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const site of sites) {
    map.set(site.site_code, getSiteClientName(site));
  }

  return map;
}

function filterSiteIdsByClient(
  sites: SiteEntry[],
  clientId?: string | null,
): Set<string> | null {
  if (!clientId) {
    return null;
  }

  return new Set(
    sites.filter((site) => site.client_id === clientId).map((site) => site.site_code),
  );
}

function buildQualityKpiRowsForMonth(
  inspections: InspectionSummaryEntry[],
  sites: SiteEntry[],
  year: number,
  month: number,
  clientId?: string | null,
): Map<string, QualityKpiSiteRow> {
  const siteClientNames = buildSiteClientNameMap(sites);
  const allowedSiteIds = filterSiteIdsByClient(sites, clientId);
  const grouped = new Map<
    string,
    {
      siteName: string;
      clientName: string;
      scores: number[];
      passCount: number;
      failCount: number;
    }
  >();

  for (const entry of inspections) {
    if (!isDateInMonth(entry.inspection_date, year, month)) {
      continue;
    }

    const siteId = entry.site_id ?? "unknown";
    if (allowedSiteIds && !allowedSiteIds.has(siteId)) {
      continue;
    }

    const siteName = getInspectionSiteName(entry);
    const clientName = siteClientNames.get(siteId) ?? "—";
    const bucket = grouped.get(siteId) ?? {
      siteName,
      clientName,
      scores: [],
      passCount: 0,
      failCount: 0,
    };

    if (entry.inspection_score_pct !== null && entry.inspection_score_pct !== undefined) {
      bucket.scores.push(Number(entry.inspection_score_pct) || 0);
    }

    const passFail = normalizePassFail(entry.pass_fail);
    if (passFail === "pass") {
      bucket.passCount += 1;
    } else if (passFail === "fail") {
      bucket.failCount += 1;
    }

    grouped.set(siteId, bucket);
  }

  const rows = new Map<string, QualityKpiSiteRow>();

  for (const [siteId, bucket] of grouped.entries()) {
    const count = Math.max(
      bucket.scores.length,
      bucket.passCount + bucket.failCount,
    );
    const passRatePct =
      count > 0 ? round1((bucket.passCount / count) * 100) : null;

    rows.set(siteId, {
      siteId,
      siteName: bucket.siteName,
      clientName: bucket.clientName,
      inspectionCount: count,
      averageScorePct: average(bucket.scores),
      passCount: bucket.passCount,
      failCount: bucket.failCount,
      passRatePct,
      scoreTrend: "none",
      priorMonthAverageScorePct: null,
    });
  }

  return rows;
}

export function buildQualityKpiSummaryReport(
  inspections: InspectionSummaryEntry[],
  sites: SiteEntry[],
  year: number,
  month: number,
  clientId?: string | null,
): QualityKpiReport {
  const currentRows = buildQualityKpiRowsForMonth(
    inspections,
    sites,
    year,
    month,
    clientId,
  );
  const prior = priorMonth(year, month);
  const priorRows = buildQualityKpiRowsForMonth(
    inspections,
    sites,
    prior.year,
    prior.month,
    clientId,
  );

  const rows = [...currentRows.values()]
    .map((row) => {
      const priorAverage = priorRows.get(row.siteId)?.averageScorePct ?? null;
      return {
        ...row,
        priorMonthAverageScorePct: priorAverage,
        scoreTrend: compareTrend(row.averageScorePct, priorAverage),
      };
    })
    .sort((left, right) => {
      const clientCompare = left.clientName.localeCompare(right.clientName);
      if (clientCompare !== 0) {
        return clientCompare;
      }

      return left.siteName.localeCompare(right.siteName);
    });

  const filteredInspections = inspections.filter((entry) => {
    if (!isDateInMonth(entry.inspection_date, year, month)) {
      return false;
    }

    const siteId = entry.site_id ?? "unknown";
    const allowedSiteIds = filterSiteIdsByClient(sites, clientId);
    return !allowedSiteIds || allowedSiteIds.has(siteId);
  });

  const priorFilteredInspections = inspections.filter((entry) => {
    if (!isDateInMonth(entry.inspection_date, prior.year, prior.month)) {
      return false;
    }

    const siteId = entry.site_id ?? "unknown";
    const allowedSiteIds = filterSiteIdsByClient(sites, clientId);
    return !allowedSiteIds || allowedSiteIds.has(siteId);
  });

  const currentScores = filteredInspections
    .map((entry) => Number(entry.inspection_score_pct) || 0)
    .filter((value) => value > 0);

  const priorScores = priorFilteredInspections
    .map((entry) => Number(entry.inspection_score_pct) || 0)
    .filter((value) => value > 0);

  const totals = {
    inspectionCount: rows.reduce((sum, row) => sum + row.inspectionCount, 0),
    averageScorePct: average(currentScores),
    passCount: rows.reduce((sum, row) => sum + row.passCount, 0),
    failCount: rows.reduce((sum, row) => sum + row.failCount, 0),
    passRatePct: null as number | null,
    scoreTrend: compareTrend(average(currentScores), average(priorScores)),
    priorMonthAverageScorePct: average(priorScores),
  };

  totals.passRatePct =
    totals.inspectionCount > 0
      ? round1((totals.passCount / totals.inspectionCount) * 100)
      : null;

  return {
    periodLabel: formatReportPeriodLabel(year, month),
    rows,
    totals,
  };
}

export function buildSitePerformanceReport(
  inspections: InspectionSummaryEntry[],
  failedInspections: FailedInspectionEntry[],
  complaints: ComplaintRegisterEntry[],
  incidents: IncidentRegisterEntry[],
  sites: SiteEntry[],
  year: number,
  month: number,
  clientId?: string | null,
): SitePerformanceRow[] {
  const allowedSiteIds = filterSiteIdsByClient(sites, clientId);
  const siteNames = new Map<string, string>();
  const siteClientNames = buildSiteClientNameMap(sites);

  for (const site of sites) {
    if (allowedSiteIds && !allowedSiteIds.has(site.site_code)) {
      continue;
    }

    siteNames.set(site.site_code, site.site_name);
  }

  const scores = new Map<string, number[]>();
  const openFailed = new Map<string, number>();
  const complaintCounts = new Map<string, number>();
  const incidentCounts = new Map<string, number>();

  for (const entry of inspections) {
    if (!isDateInMonth(entry.inspection_date, year, month)) {
      continue;
    }

    const siteId = entry.site_id ?? "unknown";
    if (allowedSiteIds && !allowedSiteIds.has(siteId)) {
      continue;
    }

    if (entry.site?.site_name) {
      siteNames.set(siteId, entry.site.site_name);
    }

    if (entry.inspection_score_pct !== null && entry.inspection_score_pct !== undefined) {
      const list = scores.get(siteId) ?? [];
      list.push(Number(entry.inspection_score_pct) || 0);
      scores.set(siteId, list);
    }
  }

  for (const entry of failedInspections) {
    if (entry.completed) {
      continue;
    }

    const siteId = entry.site_id ?? "unknown";
    if (allowedSiteIds && !allowedSiteIds.has(siteId)) {
      continue;
    }

    if (entry.site?.site_name) {
      siteNames.set(siteId, entry.site.site_name);
    }

    openFailed.set(siteId, (openFailed.get(siteId) ?? 0) + 1);
  }

  for (const entry of complaints) {
    if (!isDateInMonth(entry.date_received, year, month)) {
      continue;
    }

    const siteId = entry.site_id ?? "unknown";
    if (allowedSiteIds && !allowedSiteIds.has(siteId)) {
      continue;
    }

    if (entry.site?.site_name) {
      siteNames.set(siteId, entry.site.site_name);
    }

    complaintCounts.set(siteId, (complaintCounts.get(siteId) ?? 0) + 1);
  }

  for (const entry of incidents) {
    if (!isDateInMonth(entry.date, year, month)) {
      continue;
    }

    const siteId = entry.site_id ?? "unknown";
    if (allowedSiteIds && !allowedSiteIds.has(siteId)) {
      continue;
    }

    if (entry.site?.site_name) {
      siteNames.set(siteId, entry.site.site_name);
    }

    incidentCounts.set(siteId, (incidentCounts.get(siteId) ?? 0) + 1);
  }

  const allSiteIds = new Set<string>([
    ...siteNames.keys(),
    ...scores.keys(),
    ...openFailed.keys(),
    ...complaintCounts.keys(),
    ...incidentCounts.keys(),
  ]);

  return [...allSiteIds]
    .map((siteId) => {
      const averageInspectionScorePct = average(scores.get(siteId) ?? []);
      const openFailedInspections = openFailed.get(siteId) ?? 0;
      const complaintsReceived = complaintCounts.get(siteId) ?? 0;
      const incidentsLogged = incidentCounts.get(siteId) ?? 0;
      const issueScore =
        (100 - (averageInspectionScorePct ?? 100)) +
        openFailedInspections * 10 +
        complaintsReceived * 5 +
        incidentsLogged * 8;

      return {
        siteId,
        siteName: siteNames.get(siteId) ?? siteId,
        clientName: siteClientNames.get(siteId) ?? "—",
        averageInspectionScorePct,
        openFailedInspections,
        complaintsReceived,
        incidentsLogged,
        issueScore: round2(issueScore),
      };
    })
    .sort((left, right) => {
      const clientCompare = left.clientName.localeCompare(right.clientName);
      if (clientCompare !== 0) {
        return clientCompare;
      }

      if (right.issueScore !== left.issueScore) {
        return right.issueScore - left.issueScore;
      }

      return left.siteName.localeCompare(right.siteName);
    });
}

function calculateCorrectiveDaysOpen(entry: CorrectiveActionEntry): number | null {
  if ((entry.status ?? "").trim() === "Completed") {
    return null;
  }

  const raised = entry.date_raised?.slice(0, 10);
  if (!raised) {
    return null;
  }

  const start = new Date(`${raised}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.max(
    0,
    Math.round((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );
}

function resolveCorrectiveGroupStatus(entry: CorrectiveActionEntry): string {
  if (isCorrectiveActionOverdue(entry)) {
    return "Overdue";
  }

  return (entry.status ?? "Open").trim() || "Open";
}

export function buildCorrectiveActionStatusReport(
  actions: CorrectiveActionEntry[],
): {
  rows: CorrectiveActionReportRow[];
  groups: CorrectiveActionStatusGroup[];
} {
  const rows = actions
    .map((entry) => {
      const groupStatus = resolveCorrectiveGroupStatus(entry);
      const isOverdue = isCorrectiveActionOverdue(entry);

      return {
        actionNo: entry.action_no,
        clientName: getCorrectiveActionClientName(entry),
        issueDescription: entry.issue_description?.trim() || "—",
        responsiblePerson: entry.responsible_person?.trim() || "—",
        targetDate: entry.target_date,
        status: entry.status?.trim() || "Open",
        daysOpen: calculateCorrectiveDaysOpen(entry),
        isOverdue,
        groupStatus,
      };
    })
    .sort((left, right) => {
      const statusCompare = left.groupStatus.localeCompare(right.groupStatus);
      if (statusCompare !== 0) {
        return statusCompare;
      }

      return left.actionNo.localeCompare(right.actionNo);
    });

  const groupCounts = new Map<string, number>();
  for (const row of rows) {
    groupCounts.set(row.groupStatus, (groupCounts.get(row.groupStatus) ?? 0) + 1);
  }

  const groups = [...groupCounts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => left.status.localeCompare(right.status));

  return { rows, groups };
}

export function resolveDefaultClientReportClient(
  clients: ClientEntry[],
): ClientEntry | null {
  const match = clients.find((client) => {
    const id = client.client_id.trim().toUpperCase();
    const name = client.client_name.trim().toLowerCase();
    return (
      id === "CL-001" ||
      id === "CLI001" ||
      id === "CL001" ||
      name.includes("central university")
    );
  });

  return match ?? clients[0] ?? null;
}

function formatReportDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function buildClientServiceReport(input: {
  client: ClientEntry;
  sites: SiteEntry[];
  inspections: InspectionSummaryEntry[];
  workOrders: WorkOrderEntry[];
  incidents: IncidentRegisterEntry[];
  complaints: ComplaintRegisterEntry[];
  correctiveActions: CorrectiveActionEntry[];
  rosterConfigs: RosterConfigRecord[];
  rosterEmployees: DutyRosterEmployee[];
  rosterProjects: DutyRosterProject[];
  rosterSites: DutyRosterSite[];
  rosterHistory: RosterHistoryRecord[];
  year: number;
  month: number;
}) {
  const clientId = input.client.client_id;
  const clientSites = input.sites.filter((site) => site.client_id === clientId);
  const clientSiteIds = new Set(clientSites.map((site) => site.site_code));

  const monthInspections = input.inspections.filter(
    (entry) =>
      entry.client_id === clientId &&
      isDateInMonth(entry.inspection_date, input.year, input.month),
  );

  const qualityRows = buildQualityKpiSummaryReport(
    monthInspections,
    input.sites,
    input.year,
    input.month,
    clientId,
  ).rows.filter((row) => clientSiteIds.has(row.siteId));

  const completedWorkOrders = input.workOrders.filter(
    (entry) =>
      entry.client_id === clientId &&
      isDateInMonth(entry.date, input.year, input.month) &&
      Boolean(entry.completion_time),
  );

  const workOrdersBySite = new Map<string, { siteName: string; count: number; summary: string }>();
  for (const entry of completedWorkOrders) {
    const siteId = entry.site_id ?? "unknown";
    const siteName = getWorkOrderSiteName(entry);
    const bucket = workOrdersBySite.get(siteId) ?? {
      siteName,
      count: 0,
      summary: "",
    };
    bucket.count += 1;
    const detail = entry.service_type?.trim() || entry.area?.trim() || "General service";
    bucket.summary = bucket.summary
      ? `${bucket.summary}; ${detail}`
      : detail;
    workOrdersBySite.set(siteId, bucket);
  }

  const clientConfig = getRosterConfigForClient(
    input.rosterConfigs,
    clientId,
  );

  const rosterViewModel =
    clientConfig &&
    buildDutyRosterViewModel({
      clientId,
      clientName: input.client.client_name,
      config: clientConfig,
      employees: input.rosterEmployees,
      projects: input.rosterProjects,
      sites: input.rosterSites,
      history: input.rosterHistory,
      referenceDate: new Date(input.year, input.month, 0),
    });

  const staffingRows = rosterViewModel?.rows ?? [];

  const monthIncidents = input.incidents.filter(
    (entry) =>
      entry.client_id === clientId &&
      isDateInMonth(entry.date, input.year, input.month),
  );

  const monthComplaints = input.complaints.filter(
    (entry) =>
      entry.client_id === clientId &&
      isDateInMonth(entry.date_received, input.year, input.month),
  );

  const monthCorrectiveActions = input.correctiveActions.filter(
    (entry) =>
      entry.client_id === clientId &&
      isDateInMonth(entry.date_raised, input.year, input.month),
  );

  const overallScores = monthInspections
    .map((entry) => Number(entry.inspection_score_pct) || 0)
    .filter((value) => value > 0);

  const contractPeriod =
    input.client.contract_start && input.client.contract_end
      ? `${formatReportDate(input.client.contract_start)} – ${formatReportDate(input.client.contract_end)}`
      : input.client.contract_start
        ? `From ${formatReportDate(input.client.contract_start)}`
        : "As per active contract";

  return {
    periodLabel: formatReportPeriodLabel(input.year, input.month),
    client: input.client,
    executiveSummary: {
      contractPeriod,
      sitesCovered: clientSites.map((site) => site.site_name),
      overallAverageInspectionScore: average(overallScores),
      totalWorkOrdersCompleted: completedWorkOrders.length,
    },
    qualityRows,
    workOrdersBySite: [...workOrdersBySite.values()].sort((left, right) =>
      left.siteName.localeCompare(right.siteName),
    ),
    staffingRows,
    staffingRotationLabel: rosterViewModel?.summary.currentRotationLabel ?? "—",
    incidents: monthIncidents.map((entry) => ({
      date: entry.date,
      type: entry.incident_type?.trim() || "—",
      description: entry.description?.trim() || "—",
      status: entry.status?.trim() || "—",
      dateResolved: entry.date_resolved,
      siteName: getIncidentSiteName(entry),
    })),
    complaints: monthComplaints.map((entry) => {
      const received = entry.date_received?.slice(0, 10);
      const resolved = entry.resolution_date?.slice(0, 10) ?? null;
      let responseDays: number | null = null;

      if (received && resolved) {
        const start = new Date(`${received}T12:00:00`);
        const end = new Date(`${resolved}T12:00:00`);
        responseDays = Math.max(
          0,
          Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        );
      }

      return {
        dateReceived: entry.date_received,
        details: entry.complaint_details?.trim() || "—",
        status: entry.status?.trim() || "—",
        resolutionDate: entry.resolution_date,
        responseDays,
        siteName: getComplaintSiteName(entry),
      };
    }),
    correctiveActions: monthCorrectiveActions.map((entry) => ({
      issue: entry.issue_description?.trim() || "—",
      actionTaken: entry.notes?.trim() || entry.responsible_person?.trim() || "—",
      status: entry.status?.trim() || "—",
    })),
  };
}

export function buildMonthlyIncidentSummaryReport(
  incidents: IncidentRegisterEntry[],
  year: number,
  month: number,
) {
  const monthIncidents = incidents.filter((entry) =>
    isDateInMonth(entry.date, year, month),
  );

  const byType = new Map<string, number>();
  const bySeverity = new Map<string, number>();
  const byStatus = new Map<string, number>();

  for (const entry of monthIncidents) {
    const type = entry.incident_type?.trim() || "Unspecified";
    const severity = entry.severity?.trim() || "Unspecified";
    const status = entry.status?.trim() || "Open";
    byType.set(type, (byType.get(type) ?? 0) + 1);
    bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }

  return {
    periodLabel: formatReportPeriodLabel(year, month),
    statusCounts: [...byStatus.entries()].map(([status, count]) => ({
      status,
      count,
    })),
    typeCounts: [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count),
    severityCounts: [...bySeverity.entries()]
      .map(([severity, count]) => ({ severity, count }))
      .sort((left, right) => right.count - left.count),
    rows: monthIncidents
      .map((entry) => ({
        incidentNo: entry.incident_no,
        date: entry.date,
        clientName: getIncidentClientName(entry),
        siteName: getIncidentSiteName(entry),
        type: entry.incident_type?.trim() || "—",
        severity: entry.severity?.trim() || "—",
        status: entry.status?.trim() || "—",
        description: entry.description?.trim() || "—",
      }))
      .sort((left, right) => left.date.localeCompare(right.date)),
  };
}

export function buildEscalatedIncidentsReport(
  incidents: IncidentRegisterEntry[],
  startDate?: string | null,
  endDate?: string | null,
) {
  return incidents
    .filter((entry) => entry.escalated_to_mgmt === true)
    .filter((entry) => {
      const date = entry.date.slice(0, 10);
      if (startDate && date < startDate) {
        return false;
      }

      if (endDate && date > endDate) {
        return false;
      }

      return true;
    })
    .map((entry) => ({
      date: entry.date,
      clientName: getIncidentClientName(entry),
      siteName: getIncidentSiteName(entry),
      type: entry.incident_type?.trim() || "—",
      description: entry.description?.trim() || "—",
      severity: entry.severity?.trim() || "—",
      status: entry.status?.trim() || "—",
      actionTaken: entry.action_taken?.trim() || "—",
      daysOpen: calculateIncidentDaysOpen(entry),
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

function normalizeIssueLabel(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "Unspecified";
  }

  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

export function buildRecurringIssueTrendReport(
  incidents: IncidentRegisterEntry[],
  complaints: ComplaintRegisterEntry[],
): RecurringIssueRow[] {
  const grouped = new Map<string, RecurringIssueRow>();

  for (const entry of incidents) {
    const siteName = getIncidentSiteName(entry);
    const issueLabel = normalizeIssueLabel(entry.incident_type);
    const key = `Incident|${siteName}|${issueLabel}`;
    const existing = grouped.get(key) ?? {
      source: "Incident" as const,
      siteName,
      issueLabel,
      count: 0,
      isRecurring: false,
    };
    existing.count += 1;
    grouped.set(key, existing);
  }

  for (const entry of complaints) {
    const siteName = getComplaintSiteName(entry);
    const issueLabel = normalizeIssueLabel(entry.complaint_details);
    const key = `Complaint|${siteName}|${issueLabel}`;
    const existing = grouped.get(key) ?? {
      source: "Complaint" as const,
      siteName,
      issueLabel,
      count: 0,
      isRecurring: false,
    };
    existing.count += 1;
    grouped.set(key, existing);
  }

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      isRecurring: row.count >= 3,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.siteName.localeCompare(right.siteName);
    });
}

export function getIndividualIncidentReport(
  incidents: IncidentRegisterEntry[],
  incidentNo: string,
) {
  const entry = incidents.find((row) => row.incident_no === incidentNo);
  if (!entry) {
    return null;
  }

  return {
    incidentNo: entry.incident_no,
    date: entry.date,
    time: entry.incident_time,
    clientName: getIncidentClientName(entry),
    siteName: getIncidentSiteName(entry),
    area: entry.area?.trim() || "—",
    incidentType: entry.incident_type?.trim() || "—",
    description: entry.description?.trim() || "—",
    severity: entry.severity?.trim() || "—",
    reportedBy: getIncidentReporterName(entry),
    actionTaken: entry.action_taken?.trim() || "—",
    status: entry.status?.trim() || "—",
    dateResolved: entry.date_resolved,
    escalatedToManagement: entry.escalated_to_mgmt === true ? "Yes" : "No",
    notes: entry.notes?.trim() || "—",
    daysOpen: calculateIncidentDaysOpen(entry),
  };
}

export function buildAvailableOperationsReportYears(
  ...dateLists: string[][]
): number[] {
  const years = new Set<number>();
  const currentYear = new Date().getFullYear();
  years.add(currentYear);

  for (const dates of dateLists) {
    for (const date of dates) {
      const year = Number(date.slice(0, 4));
      if (Number.isFinite(year) && year > 0) {
        years.add(year);
      }
    }
  }

  return [...years].sort((left, right) => right - left);
}

export function formatTrendIndicator(trend: TrendDirection): string {
  if (trend === "up") {
    return "▲";
  }

  if (trend === "down") {
    return "▼";
  }

  if (trend === "flat") {
    return "→";
  }

  return "—";
}
