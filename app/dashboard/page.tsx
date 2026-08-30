import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getActiveBusinessUnitId,
  getCurrentUserClientId,
  getCurrentUserEmployeeId,
  getCurrentUserRole,
  getCurrentAuthUid,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { getDashboardVisibility } from "@/utils/rbac-access";
import { buildClientDashboardSummary } from "./client-dashboard-utils";
import ClientDashboard from "./client-dashboard";
import { buildEmployeeDashboardSummary } from "./employee-dashboard-utils";
import EmployeeDashboard from "./employee-dashboard";
import { buildOperationsDashboardSummary } from "./operations-dashboard-utils";
import OperationsDashboard from "./operations-dashboard";
import DashboardCacheShell from "./dashboard-cache-shell";
import { buildOwnerDashboardViewModel } from "./owner-dashboard-view-model";
import { fetchDashboardPageData } from "./dashboard-page-data";
import { buildSalesRepDashboardSummary } from "./sales-rep-dashboard-utils";
import SalesRepDashboard from "./sales-rep-dashboard";
import { fetchTenantBalanceSheetIntegrityStatus } from "@/utils/tenant-balance-sheet-integrity-status";

export default async function DashboardPage() {
  const role = (await getCurrentUserRole()) as AppRole | null;

  if (role === "client") {
    const clientId = await getCurrentUserClientId();

    if (!clientId) {
      return (
        <ClientDashboard
          summary={{
            clientName: "Customer",
            outstandingBalance: 0,
            invoiceCount: 0,
            siteCount: 0,
            inspectionsThisMonth: 0,
            passedInspectionsThisMonth: 0,
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
          }}
          fetchError="Your user account is not linked to a customer record."
        />
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { summary, fetchError } = await buildClientDashboardSummary(
      supabase,
      clientId,
    );

    if (!summary) {
      return (
        <ClientDashboard
          summary={{
            clientName: "Customer",
            outstandingBalance: 0,
            invoiceCount: 0,
            siteCount: 0,
            inspectionsThisMonth: 0,
            passedInspectionsThisMonth: 0,
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
          }}
          fetchError={fetchError}
        />
      );
    }

    return <ClientDashboard summary={summary} fetchError={fetchError} />;
  }

  if (role === "employee") {
    const employeeId = await getCurrentUserEmployeeId();
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    if (!employeeId) {
      return (
        <EmployeeDashboard
          summary={{
            employeeName: "Employee",
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
            attendanceRecorded: 0,
            presentDays: 0,
            leaveBalances: [],
            pendingLeaveRequests: 0,
            latestPayslipMonth: null,
          }}
          fetchError="Your user account is not linked to an employee record."
        />
      );
    }

    const { summary, fetchError } = await buildEmployeeDashboardSummary(
      supabase,
      employeeId,
    );

    if (!summary) {
      return (
        <EmployeeDashboard
          summary={{
            employeeName: "Employee",
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
            attendanceRecorded: 0,
            presentDays: 0,
            leaveBalances: [],
            pendingLeaveRequests: 0,
            latestPayslipMonth: null,
          }}
          fetchError={fetchError}
        />
      );
    }

    return <EmployeeDashboard summary={summary} fetchError={fetchError} />;
  }

  if (role === "supervisor" || role === "operations_manager") {
    const summaryClient =
      role === "supervisor" ? createAdminClient() : createClient(await cookies());
    const tenantId = await getCurrentUserTenantId();

    if (!tenantId) {
      return (
        <OperationsDashboard
          summary={{
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
            understaffedSites: 0,
            totalRosterSites: 0,
            openCorrectiveActions: 0,
            openFailedInspections: 0,
            workOrdersThisMonth: 0,
            inspectionsThisMonth: 0,
          }}
          fetchError="Your user account is not linked to a tenant record."
          roleLabel={role === "supervisor" ? "Supervisor" : "Operations"}
        />
      );
    }

    const { summary, fetchError } = await buildOperationsDashboardSummary(
      summaryClient,
      tenantId,
    );

    return (
      <OperationsDashboard
        summary={summary}
        fetchError={fetchError}
        roleLabel={role === "supervisor" ? "Supervisor" : "Operations"}
      />
    );
  }

  if (role === "sales_rep") {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { summary, fetchError } = await buildSalesRepDashboardSummary(supabase);

    if (!summary) {
      return (
        <SalesRepDashboard
          summary={{
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
            todayLabel: new Date().toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
            todaysSalesTotal: 0,
            todaysSaleCount: 0,
            monthSalesTotal: 0,
            monthSaleCount: 0,
          }}
          fetchError={fetchError}
        />
      );
    }

    return <SalesRepDashboard summary={summary} fetchError={fetchError} />;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, authUid, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getCurrentAuthUid(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  if (!authUid) {
    throw new Error("Unable to resolve the current user.");
  }

  const dashboardPageData = await fetchDashboardPageData(supabase, tenantId, {
    activeBusinessUnitId,
    viewAllBusinessUnits,
  });
  const [dashboardDataBase, balanceSheetIntegrity] = await Promise.all([
    Promise.resolve(buildOwnerDashboardViewModel(dashboardPageData, tenantId)),
    fetchTenantBalanceSheetIntegrityStatus(tenantId),
  ]);
  const dashboardData = {
    ...dashboardDataBase,
    balanceSheetIntegrity,
  };

  return (
    <DashboardCacheShell
      session={{ tenantId, authUid }}
      initialData={dashboardData}
      initialFetchError={dashboardPageData.fetchError}
      initialCachedAt={new Date().toISOString()}
      visibility={getDashboardVisibility(role)}
    />
  );
}
