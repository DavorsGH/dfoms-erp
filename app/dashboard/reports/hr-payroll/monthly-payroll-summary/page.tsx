import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchMonthlyPayrollSummaryReportData } from "../../hr-report-data";
import { MonthlyPayrollSummaryReport } from "../../hr-reports";
import ReportsShell from "../../reports-shell";

export default async function MonthlyPayrollSummaryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  if (!tenantId) {
    redirect("/login");
  }
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const data = await fetchMonthlyPayrollSummaryReportData(
    supabase,
    tenantId,
    buScope,
  );

  return (
    <ReportsShell sectionTitle="Monthly Payroll Summary">
      <MonthlyPayrollSummaryReport {...data} />
    </ReportsShell>
  );
}
