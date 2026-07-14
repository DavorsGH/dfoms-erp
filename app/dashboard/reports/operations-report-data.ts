import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CORRECTIVE_ACTION_SELECT,
  normalizeCorrectiveActionEntry,
  type CorrectiveActionEntry,
} from "../operations/corrective-actions-utils";
import {
  COMPLAINT_REGISTER_SELECT,
  normalizeComplaintRegisterEntry,
  type ComplaintRegisterEntry,
} from "../operations/complaint-register-utils";
import { CLIENT_SELECT, type ClientEntry } from "../operations/clients-utils";
import {
  normalizeDutyRosterEmployee,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type RosterConfigRecord,
  type RosterHistoryRecord,
} from "../operations/duty-roster-utils";
import {
  FAILED_INSPECTION_SELECT,
  normalizeFailedInspectionEntry,
  type FailedInspectionEntry,
} from "../operations/failed-inspections-utils";
import {
  INCIDENT_REGISTER_SELECT,
  normalizeIncidentRegisterEntry,
  type IncidentRegisterEntry,
} from "../operations/incident-register-utils";
import {
  INSPECTION_SUMMARY_SELECT,
  normalizeInspectionSummaryEntry,
  type InspectionSummaryEntry,
} from "../operations/inspection-summary-utils";
import { SITE_SELECT, type SiteEntry } from "../operations/sites-utils";
import {
  WORK_ORDER_SELECT,
  normalizeWorkOrderEntry,
  type WorkOrderEntry,
} from "../operations/work-orders-utils";
import { buildAvailableOperationsReportYears } from "./operations-reports-utils";

async function fetchInspectionSummaries(supabase: SupabaseClient) {
  return supabase
    .from("inspection_summary")
    .select(INSPECTION_SUMMARY_SELECT)
    .order("inspection_date", { ascending: false });
}

async function fetchFailedInspections(supabase: SupabaseClient) {
  return supabase
    .from("failed_inspections")
    .select(FAILED_INSPECTION_SELECT)
    .order("date_identified", { ascending: false });
}

async function fetchCorrectiveActions(supabase: SupabaseClient) {
  return supabase
    .from("corrective_actions")
    .select(CORRECTIVE_ACTION_SELECT)
    .order("date_raised", { ascending: false });
}

async function fetchComplaints(supabase: SupabaseClient) {
  return supabase
    .from("complaint_register")
    .select(COMPLAINT_REGISTER_SELECT)
    .order("date_received", { ascending: false });
}

async function fetchIncidents(supabase: SupabaseClient) {
  return supabase
    .from("incident_register")
    .select(INCIDENT_REGISTER_SELECT)
    .order("date", { ascending: false });
}

async function fetchSites(supabase: SupabaseClient) {
  return supabase
    .from("sites")
    .select(SITE_SELECT)
    .order("site_name", { ascending: true });
}

async function fetchClients(supabase: SupabaseClient) {
  return supabase
    .from("clients")
    .select(CLIENT_SELECT)
    .order("client_name", { ascending: true });
}

async function fetchWorkOrders(supabase: SupabaseClient) {
  return supabase
    .from("work_orders")
    .select(WORK_ORDER_SELECT)
    .order("date", { ascending: false });
}

async function fetchDutyRosterBundle(supabase: SupabaseClient) {
  const [
    { data: configRows, error: configError },
    { data: employees, error: employeesError },
    { data: projects, error: projectsError },
    { data: history, error: historyError },
  ] = await Promise.all([
    supabase.from("roster_config").select("*").limit(1),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, employment_status, project_ref:projects!contract_project(project_code, project_name)",
      )
      .order("staff_id", { ascending: true }),
    supabase
      .from("projects")
      .select("project_code, project_name, required_staff")
      .order("project_name", { ascending: true }),
    supabase
      .from("roster_history")
      .select("*")
      .order("effective_date", { ascending: false }),
  ]);

  return {
    rosterConfig: (configRows?.[0] as RosterConfigRecord | undefined) ?? null,
    rosterEmployees:
      (employees as DutyRosterEmployee[] | null)?.map((employee) =>
        normalizeDutyRosterEmployee(employee),
      ) ?? [],
    rosterProjects: (projects as DutyRosterProject[] | null) ?? [],
    rosterHistory: (history as RosterHistoryRecord[] | null) ?? [],
    rosterFetchError:
      configError?.message ??
      employeesError?.message ??
      projectsError?.message ??
      historyError?.message ??
      null,
  };
}

function normalizeInspections(
  rows: InspectionSummaryEntry[] | null,
): InspectionSummaryEntry[] {
  return (rows ?? []).map((row) => normalizeInspectionSummaryEntry(row));
}

function normalizeIncidents(
  rows: IncidentRegisterEntry[] | null,
): IncidentRegisterEntry[] {
  return (rows ?? []).map((row) => normalizeIncidentRegisterEntry(row));
}

function buildYearsFromInspectionDates(dates: string[]) {
  return buildAvailableOperationsReportYears(dates);
}

export async function fetchQualityKpiSummaryReportData(
  supabase: SupabaseClient,
) {
  const { data, error } = await fetchInspectionSummaries(supabase);
  const inspections = normalizeInspections(data as InspectionSummaryEntry[] | null);

  return {
    initialInspections: inspections,
    availableYears: buildYearsFromInspectionDates(
      inspections.map((row) => row.inspection_date),
    ),
    fetchError: error?.message ?? null,
  };
}

export async function fetchSitePerformanceReportData(supabase: SupabaseClient) {
  const [
    { data: inspections, error: inspectionsError },
    { data: failedInspections, error: failedError },
    { data: complaints, error: complaintsError },
    { data: incidents, error: incidentsError },
    { data: sites, error: sitesError },
  ] = await Promise.all([
    fetchInspectionSummaries(supabase),
    fetchFailedInspections(supabase),
    fetchComplaints(supabase),
    fetchIncidents(supabase),
    fetchSites(supabase),
  ]);

  const normalizedInspections = normalizeInspections(
    inspections as InspectionSummaryEntry[] | null,
  );
  const incidentFetchError = incidentsError?.message ?? null;

  return {
    initialInspections: normalizedInspections,
    initialFailedInspections:
      (failedInspections as FailedInspectionEntry[] | null)?.map((row) =>
        normalizeFailedInspectionEntry(row),
      ) ?? [],
    initialComplaints:
      (complaints as ComplaintRegisterEntry[] | null)?.map((row) =>
        normalizeComplaintRegisterEntry(row),
      ) ?? [],
    initialIncidents: normalizeIncidents(
      incidents as IncidentRegisterEntry[] | null,
    ),
    initialSites: (sites as SiteEntry[] | null) ?? [],
    availableYears: buildYearsFromInspectionDates(
      normalizedInspections.map((row) => row.inspection_date),
    ),
    fetchError:
      inspectionsError?.message ??
      failedError?.message ??
      complaintsError?.message ??
      sitesError?.message ??
      null,
    incidentFetchError,
  };
}

export async function fetchCorrectiveActionStatusReportData(
  supabase: SupabaseClient,
) {
  const { data, error } = await fetchCorrectiveActions(supabase);

  return {
    initialCorrectiveActions:
      (data as CorrectiveActionEntry[] | null)?.map((row) =>
        normalizeCorrectiveActionEntry(row),
      ) ?? [],
    fetchError: error?.message ?? null,
  };
}

export async function fetchClientServiceReportData(supabase: SupabaseClient) {
  const [
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
    { data: inspections, error: inspectionsError },
    { data: workOrders, error: workOrdersError },
    { data: incidents, error: incidentsError },
    { data: complaints, error: complaintsError },
    { data: correctiveActions, error: correctiveActionsError },
    rosterBundle,
  ] = await Promise.all([
    fetchClients(supabase),
    fetchSites(supabase),
    fetchInspectionSummaries(supabase),
    fetchWorkOrders(supabase),
    fetchIncidents(supabase),
    fetchComplaints(supabase),
    fetchCorrectiveActions(supabase),
    fetchDutyRosterBundle(supabase),
  ]);

  const normalizedInspections = normalizeInspections(
    inspections as InspectionSummaryEntry[] | null,
  );

  return {
    initialClients: (clients as ClientEntry[] | null) ?? [],
    initialSites: (sites as SiteEntry[] | null) ?? [],
    initialInspections: normalizedInspections,
    initialWorkOrders:
      (workOrders as WorkOrderEntry[] | null)?.map((row) =>
        normalizeWorkOrderEntry(row),
      ) ?? [],
    initialIncidents: normalizeIncidents(
      incidents as IncidentRegisterEntry[] | null,
    ),
    initialComplaints:
      (complaints as ComplaintRegisterEntry[] | null)?.map((row) =>
        normalizeComplaintRegisterEntry(row),
      ) ?? [],
    initialCorrectiveActions:
      (correctiveActions as CorrectiveActionEntry[] | null)?.map((row) =>
        normalizeCorrectiveActionEntry(row),
      ) ?? [],
    rosterConfig: rosterBundle.rosterConfig,
    rosterEmployees: rosterBundle.rosterEmployees,
    rosterProjects: rosterBundle.rosterProjects,
    rosterHistory: rosterBundle.rosterHistory,
    availableYears: buildYearsFromInspectionDates(
      normalizedInspections.map((row) => row.inspection_date),
    ),
    fetchError:
      clientsError?.message ??
      sitesError?.message ??
      inspectionsError?.message ??
      workOrdersError?.message ??
      complaintsError?.message ??
      correctiveActionsError?.message ??
      rosterBundle.rosterFetchError ??
      null,
    incidentFetchError: incidentsError?.message ?? null,
  };
}

export async function fetchIndividualIncidentReportData(
  supabase: SupabaseClient,
) {
  const { data, error } = await fetchIncidents(supabase);
  const incidents = normalizeIncidents(data as IncidentRegisterEntry[] | null);

  return {
    initialIncidents: incidents,
    fetchError: error?.message ?? null,
  };
}

export async function fetchMonthlyIncidentSummaryReportData(
  supabase: SupabaseClient,
) {
  const { data, error } = await fetchIncidents(supabase);
  const incidents = normalizeIncidents(data as IncidentRegisterEntry[] | null);

  return {
    initialIncidents: incidents,
    availableYears: buildAvailableOperationsReportYears(
      incidents.map((row) => row.date),
    ),
    fetchError: error?.message ?? null,
  };
}

export async function fetchEscalatedIncidentsReportData(
  supabase: SupabaseClient,
) {
  const { data, error } = await fetchIncidents(supabase);
  const incidents = normalizeIncidents(data as IncidentRegisterEntry[] | null);

  return {
    initialIncidents: incidents,
    fetchError: error?.message ?? null,
  };
}

export async function fetchRecurringIssueTrendReportData(
  supabase: SupabaseClient,
) {
  const [
    { data: incidents, error: incidentsError },
    { data: complaints, error: complaintsError },
  ] = await Promise.all([fetchIncidents(supabase), fetchComplaints(supabase)]);

  return {
    initialIncidents: normalizeIncidents(
      incidents as IncidentRegisterEntry[] | null,
    ),
    initialComplaints:
      (complaints as ComplaintRegisterEntry[] | null)?.map((row) =>
        normalizeComplaintRegisterEntry(row),
      ) ?? [],
    fetchError: incidentsError?.message ?? complaintsError?.message ?? null,
  };
}
