import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import HrPayrollShell from "../../hr-payroll-shell";
import EmployeeAnnouncementsShell from "../employee-announcements-shell";
import EmployeeMessageTemplates from "./employee-message-templates";
import {
  EMPLOYEE_MESSAGE_TEMPLATE_SELECT,
  normalizeEmployeeMessageTemplateRow,
  type EmployeeMessageTemplateRow,
} from "@/utils/employee-message-templates-types";

export default async function EmployeeMessageTemplatesPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!tenantId) {
    return (
      <HrPayrollShell sectionTitle="Employee Announcements">
        <EmployeeAnnouncementsShell sectionTitle="Templates">
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Unable to resolve tenant for employee message templates.
          </p>
        </EmployeeAnnouncementsShell>
      </HrPayrollShell>
    );
  }

  const { data, error } = await supabase
    .from("employee_message_templates")
    .select(EMPLOYEE_MESSAGE_TEMPLATE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false });

  const templates = ((data as EmployeeMessageTemplateRow[] | null) ?? []).map(
    normalizeEmployeeMessageTemplateRow,
  );

  return (
    <HrPayrollShell sectionTitle="Employee Announcements">
      <EmployeeAnnouncementsShell sectionTitle="Templates">
        <EmployeeMessageTemplates
          tenantId={tenantId}
          initialTemplates={templates}
          fetchError={error?.message ?? null}
        />
      </EmployeeAnnouncementsShell>
    </HrPayrollShell>
  );
}
