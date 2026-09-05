import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import { fetchPositions } from "@/app/dashboard/employees/lookup-utils";
import {
  filterActiveEmployees,
  type HrEmployee,
} from "@/app/dashboard/hr-payroll/employee-utils";
import HrPayrollShell from "../../hr-payroll-shell";
import EmployeeAnnouncementsShell from "../employee-announcements-shell";
import EmployeeAnnouncementsCampaigns from "./employee-announcements-campaigns";
import {
  EMPLOYEE_ANNOUNCEMENT_SELECT,
  normalizeEmployeeAnnouncementRow,
  type EmployeeAnnouncementRow,
} from "@/utils/employee-announcements-types";
import {
  EMPLOYEE_MESSAGE_TEMPLATE_SELECT,
  normalizeEmployeeMessageTemplateRow,
  type EmployeeMessageTemplateRow,
} from "@/utils/employee-message-templates-types";

const AUDIENCE_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, employment_status" as const;

export default async function EmployeeAnnouncementsCampaignsPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!tenantId) {
    return (
      <HrPayrollShell sectionTitle="Employee Announcements">
        <EmployeeAnnouncementsShell sectionTitle="Campaigns">
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Unable to resolve tenant for employee announcements.
          </p>
        </EmployeeAnnouncementsShell>
      </HrPayrollShell>
    );
  }

  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [announcementsResult, templatesResult, employeesResult, positions] =
    await Promise.all([
      supabase
        .from("employee_announcements")
        .select(EMPLOYEE_ANNOUNCEMENT_SELECT)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      supabase
        .from("employee_message_templates")
        .select(EMPLOYEE_MESSAGE_TEMPLATE_SELECT)
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      applyBusinessUnitScope(
        supabase
          .from("employees")
          .select(AUDIENCE_EMPLOYEE_SELECT)
          .eq("tenant_id", tenantId),
        buScope,
      ).order("full_name"),
      fetchPositions(supabase),
    ]);

  const announcements = (
    (announcementsResult.data as unknown as EmployeeAnnouncementRow[] | null) ??
    []
  ).map(normalizeEmployeeAnnouncementRow);

  const activeTemplates = (
    (templatesResult.data as EmployeeMessageTemplateRow[] | null) ?? []
  ).map(normalizeEmployeeMessageTemplateRow);

  const employees = filterActiveEmployees(
    (employeesResult.data as HrEmployee[] | null) ?? [],
  ).map((employee) => ({
    employee_id: employee.employee_id,
    staff_id: employee.staff_id,
    full_name: employee.full_name,
  }));

  const fetchError =
    announcementsResult.error?.message ??
    templatesResult.error?.message ??
    employeesResult.error?.message ??
    null;

  return (
    <HrPayrollShell sectionTitle="Employee Announcements">
      <EmployeeAnnouncementsShell sectionTitle="Campaigns">
        <EmployeeAnnouncementsCampaigns
          tenantId={tenantId}
          initialAnnouncements={announcements}
          activeTemplates={activeTemplates}
          positions={positions}
          employees={employees}
          fetchError={fetchError}
        />
      </EmployeeAnnouncementsShell>
    </HrPayrollShell>
  );
}
