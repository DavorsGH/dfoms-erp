import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  CORRECTIVE_ACTION_SELECT,
  normalizeCorrectiveActionEntry,
  type CorrectiveActionEntry,
} from "../operations/corrective-actions-utils";
import {
  applySiteCodeScope,
  applySiteIdScope,
  fetchScopedSiteCodes,
} from "../operations/site-bu-scope-utils";
import {
  COMPLAINT_REGISTER_SELECT,
  normalizeComplaintRegisterEntry,
  type ComplaintRegisterEntry,
} from "../operations/complaint-register-utils";
import { CLIENT_SELECT, type ClientEntry } from "../operations/clients-utils";
import {
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
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
import {
  normalizeProjectEntry,
  PROJECT_SELECT,
} from "../administration/projects-utils";
import { buildAvailableOperationsReportYears } from "./operations-reports-utils";
import {
  ROSTER_CONFIG_SELECT,
  type RosterConfigRecord,
} from "../operations/roster-config-utils";

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

async function fetchCorrectiveActions(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  return applyBusinessUnitScope(
    supabase.from("corrective_actions").select(CORRECTIVE_ACTION_SELECT),
    buScope,
  ).order("date_raised", { ascending: false });
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
    .from("customers")
    .select(CLIENT_SELECT)
    .order("client_name", { ascending: true });
}

async function fetchWorkOrders(supabase: SupabaseClient) {
  return supabase
    .from("work_orders")
    .select(WORK_ORDER_SELECT)
    .order("date", { ascending: false });
}

type DutyRosterBundle = {
  rosterConfigs: RosterConfigRecord[];
  rosterEmployees: DutyRosterEmployee[];
  rosterProjects: DutyRosterProject[];
  rosterSites: DutyRosterSite[];
  rosterHistory: RosterHistoryRecord[];
  rosterFetchError: string | null;
};

const DUTY_ROSTER_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, position, shift, contract_project, employment_status, project_ref:projects!employees_contract_project_fkey(project_code, project_name), tenant_id";

function normalizeDutyRosterBundle(input: {
  configRows: RosterConfigRecord[] | null;
  employees: DutyRosterEmployee[] | null;
  projects: DutyRosterProject[] | null;
  sites: DutyRosterSite[] | null;
  history: RosterHistoryRecord[] | null;
  configError?: string | null;
  employeesError?: string | null;
  projectsError?: string | null;
  sitesError?: string | null;
  historyError?: string | null;
}): DutyRosterBundle {
  return {
    rosterConfigs: input.configRows ?? [],
    rosterEmployees:
      input.employees?.map((employee) => normalizeDutyRosterEmployee(employee)) ??
      [],
    rosterProjects:
      input.projects?.map((project) => normalizeProjectEntry(project)) ?? [],
    rosterSites:
      input.sites?.map((site) => normalizeDutyRosterSite(site)) ?? [],
    rosterHistory: input.history ?? [],
    rosterFetchError:
      input.configError ??
      input.employeesError ??
      input.projectsError ??
      input.sitesError ??
      input.historyError ??
      null,
  };
}

async function fetchDutyRosterBundle(
  supabase: SupabaseClient,
): Promise<DutyRosterBundle> {
  const [
    { data: configRows, error: configError },
    { data: employees, error: employeesError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    { data: history, error: historyError },
  ] = await Promise.all([
    supabase.from("roster_config").select(ROSTER_CONFIG_SELECT),
    // Direct select (not duty-roster RPC): client portal needs facility-project
    // staff visible via client_can_view_roster_employee (script 53) — or the
    // elevated client-portal fetch below when RLS is incomplete.
    supabase
      .from("employees")
      .select(DUTY_ROSTER_EMPLOYEE_SELECT)
      .order("staff_id", { ascending: true }),
    supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .order("project_name", { ascending: true }),
    supabase.from("sites").select(SITE_SELECT).order("site_name", { ascending: true }),
    supabase
      .from("roster_history")
      .select("*")
      .order("effective_date", { ascending: false }),
  ]);

  return normalizeDutyRosterBundle({
    configRows: configRows as RosterConfigRecord[] | null,
    employees: employees as DutyRosterEmployee[] | null,
    projects: projects as DutyRosterProject[] | null,
    sites: sites as DutyRosterSite[] | null,
    history: history as RosterHistoryRecord[] | null,
    configError: configError?.message ?? null,
    employeesError: employeesError?.message ?? null,
    projectsError: projectsError?.message ?? null,
    sitesError: sitesError?.message ?? null,
    historyError: historyError?.message ?? null,
  });
}

/**
 * Client portal RLS historically only exposed the parent contract project, so
 * buildDutyRosterViewModel saw sites/required_staff but Actual Staff = 0.
 * Elevate with service role after the page has verified the caller's client_id,
 * scoped to that client + tenant — same headcount source as Operations Duty Roster.
 */
async function fetchDutyRosterBundleForClientPortal(input: {
  clientId: string;
  tenantId: string | null;
}): Promise<DutyRosterBundle> {
  const admin = createAdminClient();
  const clientId = input.clientId;

  let sitesQuery = admin
    .from("sites")
    .select(SITE_SELECT)
    .eq("client_id", clientId)
    .order("site_name", { ascending: true });
  let projectsQuery = admin
    .from("projects")
    .select(PROJECT_SELECT)
    .order("project_name", { ascending: true });
  let employeesQuery = admin
    .from("employees")
    .select(DUTY_ROSTER_EMPLOYEE_SELECT)
    .order("staff_id", { ascending: true });

  if (input.tenantId) {
    sitesQuery = sitesQuery.eq("tenant_id", input.tenantId);
    projectsQuery = projectsQuery.eq("tenant_id", input.tenantId);
    employeesQuery = employeesQuery.eq("tenant_id", input.tenantId);
  }

  const [
    { data: configRows, error: configError },
    { data: employees, error: employeesError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    { data: history, error: historyError },
  ] = await Promise.all([
    admin
      .from("roster_config")
      .select(ROSTER_CONFIG_SELECT)
      .eq("client_id", clientId),
    employeesQuery,
    projectsQuery,
    sitesQuery,
    admin
      .from("roster_history")
      .select("*")
      .order("effective_date", { ascending: false }),
  ]);

  return normalizeDutyRosterBundle({
    configRows: configRows as RosterConfigRecord[] | null,
    employees: employees as DutyRosterEmployee[] | null,
    projects: projects as DutyRosterProject[] | null,
    sites: sites as DutyRosterSite[] | null,
    history: history as RosterHistoryRecord[] | null,
    configError: configError?.message ?? null,
    employeesError: employeesError?.message ?? null,
    projectsError: projectsError?.message ?? null,
    sitesError: sitesError?.message ?? null,
    historyError: historyError?.message ?? null,
  });
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
  tenantId?: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const scopedSites = tenantId
    ? await fetchScopedSiteCodes(supabase, tenantId, buScope)
    : { siteCodes: null as string[] | null, error: null as string | null };

  const [
    { data, error },
    { data: sites, error: sitesError },
    { data: clients, error: clientsError },
  ] = await Promise.all([
    applySiteIdScope(
      supabase
        .from("inspection_summary")
        .select(INSPECTION_SUMMARY_SELECT),
      scopedSites.siteCodes,
    ).order("inspection_date", { ascending: false }),
    applySiteCodeScope(
      supabase.from("sites").select(SITE_SELECT),
      scopedSites.siteCodes,
    ).order("site_name", { ascending: true }),
    fetchClients(supabase),
  ]);
  const inspections = normalizeInspections(data as InspectionSummaryEntry[] | null);

  return {
    initialInspections: inspections,
    initialSites: (sites as SiteEntry[] | null) ?? [],
    initialClients: (clients as ClientEntry[] | null) ?? [],
    availableYears: buildYearsFromInspectionDates(
      inspections.map((row) => row.inspection_date),
    ),
    fetchError:
      scopedSites.error ??
      error?.message ??
      sitesError?.message ??
      clientsError?.message ??
      null,
  };
}

export async function fetchSitePerformanceReportData(
  supabase: SupabaseClient,
  tenantId?: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const scopedSites = tenantId
    ? await fetchScopedSiteCodes(supabase, tenantId, buScope)
    : { siteCodes: null as string[] | null, error: null as string | null };

  const [
    { data: inspections, error: inspectionsError },
    { data: failedInspections, error: failedError },
    { data: complaints, error: complaintsError },
    { data: incidents, error: incidentsError },
    { data: sites, error: sitesError },
    { data: clients, error: clientsError },
  ] = await Promise.all([
    applySiteIdScope(
      supabase
        .from("inspection_summary")
        .select(INSPECTION_SUMMARY_SELECT),
      scopedSites.siteCodes,
    ).order("inspection_date", { ascending: false }),
    applySiteIdScope(
      supabase
        .from("failed_inspections")
        .select(FAILED_INSPECTION_SELECT),
      scopedSites.siteCodes,
    ).order("date_identified", { ascending: false }),
    applySiteIdScope(
      supabase
        .from("complaint_register")
        .select(COMPLAINT_REGISTER_SELECT),
      scopedSites.siteCodes,
    ).order("date_received", { ascending: false }),
    applySiteIdScope(
      supabase
        .from("incident_register")
        .select(INCIDENT_REGISTER_SELECT),
      scopedSites.siteCodes,
    ).order("date", { ascending: false }),
    applySiteCodeScope(
      supabase.from("sites").select(SITE_SELECT),
      scopedSites.siteCodes,
    ).order("site_name", { ascending: true }),
    fetchClients(supabase),
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
    initialClients: (clients as ClientEntry[] | null) ?? [],
    availableYears: buildYearsFromInspectionDates(
      normalizedInspections.map((row) => row.inspection_date),
    ),
    fetchError:
      scopedSites.error ??
      inspectionsError?.message ??
      failedError?.message ??
      complaintsError?.message ??
      sitesError?.message ??
      clientsError?.message ??
      null,
    incidentFetchError,
  };
}

export async function fetchCorrectiveActionStatusReportData(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const { data, error } = await applyBusinessUnitScope(
    supabase.from("corrective_actions").select(CORRECTIVE_ACTION_SELECT),
    buScope,
  ).order("date_raised", { ascending: false });

  return {
    initialCorrectiveActions:
      (data as CorrectiveActionEntry[] | null)?.map((row) =>
        normalizeCorrectiveActionEntry(row),
      ) ?? [],
    fetchError: error?.message ?? null,
  };
}

export async function fetchClientServiceReportData(
  supabase: SupabaseClient,
  options?: {
    /**
     * When set (client portal), load Duty Roster headcount via service role
     * scoped to this client/tenant so Actual Staff is not forced to 0 by RLS.
     */
    elevateRosterForClientId?: string;
    tenantId?: string | null;
    buScope?: BusinessUnitReadScope;
  },
) {
  const elevateClientId = options?.elevateRosterForClientId?.trim() || null;
  const buScope = options?.buScope ?? { mode: "all" };

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
    fetchCorrectiveActions(supabase, buScope),
    elevateClientId
      ? fetchDutyRosterBundleForClientPortal({
          clientId: elevateClientId,
          tenantId: options?.tenantId ?? null,
        })
      : fetchDutyRosterBundle(supabase),
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
    rosterConfigs: rosterBundle.rosterConfigs,
    rosterEmployees: rosterBundle.rosterEmployees,
    rosterProjects: rosterBundle.rosterProjects,
    rosterSites: rosterBundle.rosterSites,
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
