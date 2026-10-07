import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { ROUTE_HANDLER_AUTH_OPTS } from "@/lib/middleware-trust-policy";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { canManageLeaveBalances } from "@/utils/rbac-access";
import type { AppRole } from "../../user-account-types";
import { filterActiveEmployees } from "../employee-utils";
import { fetchLeaveBalancesPageData } from "../leave-balances-page-fetch";
import HrPayrollShell from "../hr-payroll-shell";
import LeaveBalances from "../leave-balances";

export default async function LeaveBalancesPage() {
  const role = (await getCurrentUserRole()) as AppRole | null;
  const tenantId = await getCurrentUserTenantId(ROUTE_HANDLER_AUTH_OPTS);
  const currentYear = new Date().getFullYear();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { balances, employees, leaveTypes, error: fetchError } =
    await fetchLeaveBalancesPageData(
      supabase,
      tenantId,
      buScope,
      currentYear,
    );

  return (
    <HrPayrollShell sectionTitle="Leave Balances">
      <LeaveBalances
        initialBalances={balances}
        employees={filterActiveEmployees(employees)}
        leaveTypes={leaveTypes}
        currentYear={currentYear}
        canManage={canManageLeaveBalances(role)}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
