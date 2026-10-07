import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchLeavePageData } from "../leave-page-fetch";
import LeaveManagement from "../leave-management";
import { filterActiveEmployees } from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function LeavePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { entries, employees, leaveTypeOptions, error: fetchError } =
    await fetchLeavePageData(supabase, tenantId, buScope);

  return (
    <HrPayrollShell sectionTitle="Leave Management">
      <LeaveManagement
        initialEntries={entries}
        initialEmployees={filterActiveEmployees(employees)}
        fetchError={fetchError}
        leaveTypeOptions={leaveTypeOptions}
        tenantId={tenantId}
      />
    </HrPayrollShell>
  );
}
