import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROJECT_SELECT,
  normalizeProjectEntry,
} from "./administration/projects-utils";
import { CLIENT_SELECT } from "./operations/clients-utils";
import {
  buildDutyRosterViewModel,
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "./operations/duty-roster-utils";
import {
  ROSTER_CONFIG_SELECT,
  type RosterConfigRecord,
} from "./operations/roster-config-utils";
import { SITE_ASSIGNMENT_SELECT } from "./operations/sites-utils";

export type OperationsDashboardSummary = {
  periodLabel: string;
  understaffedSites: number;
  totalRosterSites: number;
  openCorrectiveActions: number;
  openFailedInspections: number;
  workOrdersThisMonth: number;
  inspectionsThisMonth: number;
};

function currentMonthBounds() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  return {
    periodLabel: start.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    }),
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
  };
}

function isOpenCorrectiveStatus(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized !== "completed" && normalized !== "";
}

export async function buildOperationsDashboardSummary(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ summary: OperationsDashboardSummary; fetchError: string | null }> {
  const { periodLabel, startIso, endIso } = currentMonthBounds();

  const [
    { data: clients, error: clientsError },
    { data: configs, error: configsError },
    { data: employeesRaw, error: employeesError },
    { data: projectsRaw, error: projectsError },
    { data: sitesRaw, error: sitesError },
    { data: history, error: historyError },
    { data: correctiveActions, error: correctiveError },
    { data: failedInspections, error: failedError },
    { data: workOrders, error: workOrdersError },
    { data: inspections, error: inspectionsError },
  ] = await Promise.all([
    supabase.from("customers").select(CLIENT_SELECT).eq("tenant_id", tenantId),
    supabase.from("roster_config").select(ROSTER_CONFIG_SELECT).eq("tenant_id", tenantId),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, employment_status, project_ref:projects!contract_project(project_code, project_name)",
      )
      .eq("tenant_id", tenantId),
    supabase.from("projects").select(PROJECT_SELECT).eq("tenant_id", tenantId),
    supabase.from("sites").select(SITE_ASSIGNMENT_SELECT).eq("tenant_id", tenantId),
    supabase.from("roster_history").select("*").eq("tenant_id", tenantId),
    supabase.from("corrective_actions").select("status").eq("tenant_id", tenantId),
    supabase.from("failed_inspections").select("issue_no").eq("tenant_id", tenantId),
    supabase
      .from("work_orders")
      .select("work_order_no, date")
      .eq("tenant_id", tenantId)
      .gte("date", startIso)
      .lte("date", endIso),
    supabase
      .from("inspection_summary")
      .select("checklist_id, inspection_date")
      .eq("tenant_id", tenantId)
      .gte("inspection_date", startIso)
      .lte("inspection_date", endIso),
  ]);

  const fetchError =
    clientsError?.message ??
    configsError?.message ??
    employeesError?.message ??
    projectsError?.message ??
    sitesError?.message ??
    historyError?.message ??
    correctiveError?.message ??
    failedError?.message ??
    workOrdersError?.message ??
    inspectionsError?.message ??
    null;

  const employees =
    (employeesRaw as DutyRosterEmployee[] | null)?.map((employee) =>
      normalizeDutyRosterEmployee(employee),
    ) ?? [];
  const projects =
    (projectsRaw ?? []).map((project) => normalizeProjectEntry(project)) ??
    [];
  const sites =
    (sitesRaw as DutyRosterSite[] | null)?.map((site) =>
      normalizeDutyRosterSite(site),
    ) ?? [];
  const rosterHistory = (history as RosterHistoryRecord[] | null) ?? [];
  const rosterConfigs = (configs as RosterConfigRecord[] | null) ?? [];

  let understaffedSites = 0;
  let totalRosterSites = 0;

  for (const client of clients ?? []) {
    const config = rosterConfigs.find(
      (entry) => entry.client_id === client.client_id,
    );
    if (!config) {
      continue;
    }

    const viewModel = buildDutyRosterViewModel({
      clientId: client.client_id,
      clientName: client.client_name,
      config,
      employees,
      projects,
      sites,
      history: rosterHistory,
    });

    totalRosterSites += viewModel.rows.length;
    understaffedSites += viewModel.rows.filter((row) => row.isStaffingMismatch)
      .length;
  }

  return {
    summary: {
      periodLabel,
      understaffedSites,
      totalRosterSites,
      openCorrectiveActions: (correctiveActions ?? []).filter((row) =>
        isOpenCorrectiveStatus(row.status),
      ).length,
      openFailedInspections: failedInspections?.length ?? 0,
      workOrdersThisMonth: workOrders?.length ?? 0,
      inspectionsThisMonth: inspections?.length ?? 0,
    },
    fetchError,
  };
}
