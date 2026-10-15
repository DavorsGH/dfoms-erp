import "server-only";

import { buildOperationsDashboardSummary } from "@/app/dashboard/operations-dashboard-utils";
import { COMPLAINT_REGISTER_SELECT } from "@/app/dashboard/operations/complaint-register-utils";
import { FAILED_INSPECTION_SELECT } from "@/app/dashboard/operations/failed-inspections-utils";
import { WORK_ORDER_SELECT } from "@/app/dashboard/operations/work-orders-utils";
import { canAccessOperationsSection } from "@/utils/rbac-access";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  applySiteIdScope,
  fetchScopedSiteCodes,
} from "@/app/dashboard/operations/site-bu-scope-utils";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";

export async function getDutyRosterSummary(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessOperationsSection(sessionResult.session.role)) {
    return { error: "You do not have access to duty roster data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
    const buScope = resolveBusinessUnitReadScope({
      viewAllBusinessUnits,
      activeBusinessUnitId,
    });
    const { summary, fetchError } = await buildOperationsDashboardSummary(
      supabase,
      sessionResult.session.tenantId,
      buScope,
    );

    return {
      periodLabel: summary.periodLabel,
      totalRosterSites: summary.totalRosterSites,
      understaffedSites: summary.understaffedSites,
      note:
        summary.understaffedSites > 0
          ? `${summary.understaffedSites} site(s) are understaffed on the current roster.`
          : "No understaffed sites flagged on the current roster.",
      fetchWarning: fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_duty_roster_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getOpenWorkItems(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessOperationsSection(sessionResult.session.role)) {
    return { error: "You do not have access to operations work items." };
  }

  try {
    const supabase = await getStaffSupabase();
    const tenantId = sessionResult.session.tenantId;
    const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
    const buScope = resolveBusinessUnitReadScope({
      viewAllBusinessUnits,
      activeBusinessUnitId,
    });
    const scopedSites = await fetchScopedSiteCodes(supabase, tenantId, buScope);

    const [{ data: workOrders, error: workOrdersError }, { data: failedInspections, error: failedError }, { data: complaints, error: complaintsError }] =
      await Promise.all([
        applySiteIdScope(
          supabase
            .from("work_orders")
            .select(WORK_ORDER_SELECT)
            .eq("tenant_id", tenantId)
            .is("completion_time", null),
          scopedSites.siteCodes,
        )
          .order("date", { ascending: false })
          .limit(LIST_LIMIT),
        applySiteIdScope(
          supabase
            .from("failed_inspections")
            .select(FAILED_INSPECTION_SELECT)
            .eq("tenant_id", tenantId)
            .or("completed.is.null,completed.eq.false"),
          scopedSites.siteCodes,
        )
          .order("date_identified", { ascending: false })
          .limit(LIST_LIMIT),
        applySiteIdScope(
          supabase
            .from("complaint_register")
            .select(COMPLAINT_REGISTER_SELECT)
            .eq("tenant_id", tenantId)
            .not("status", "ilike", "closed%"),
          scopedSites.siteCodes,
        )
          .order("date_received", { ascending: false })
          .limit(LIST_LIMIT),
      ]);

    if (workOrdersError || failedError || complaintsError) {
      console.error(
        "[assistant] get_open_work_items failed:",
        workOrdersError?.message ?? failedError?.message ?? complaintsError?.message,
      );
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const items: Array<Record<string, unknown>> = [];

    for (const row of workOrders ?? []) {
      const client = Array.isArray(row.client) ? row.client[0] : row.client;
      const site = Array.isArray(row.site) ? row.site[0] : row.site;
      items.push({
        type: "work_order",
        reference: row.work_order_no,
        date: row.date,
        clientName: client?.client_name ?? null,
        siteName: site?.site_name ?? null,
        summary: row.service_type ?? row.area ?? "Work order",
      });
    }

    for (const row of failedInspections ?? []) {
      const client = Array.isArray(row.client) ? row.client[0] : row.client;
      items.push({
        type: "failed_inspection",
        reference: row.issue_no,
        date: row.date_identified,
        clientName: client?.client_name ?? null,
        summary: row.problem_description ?? "Failed inspection",
      });
    }

    for (const row of complaints ?? []) {
      const client = Array.isArray(row.client) ? row.client[0] : row.client;
      items.push({
        type: "complaint",
        reference: row.complaint_no,
        date: row.date_received,
        clientName: client?.client_name ?? null,
        summary: row.complaint_details ?? "Complaint",
        status: row.status,
      });
    }

    return {
      totalCount: items.length,
      items: items.slice(0, LIST_LIMIT),
      fetchWarning: scopedSites.error,
    };
  } catch (error) {
    console.error("[assistant] get_open_work_items threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
