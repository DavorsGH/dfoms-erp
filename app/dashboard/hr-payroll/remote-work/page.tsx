import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  applyStaffIdScope,
  fetchScopedStaffIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  ARRANGEMENT_COLUMNS,
  canManageRemoteWorkArrangements,
  type RemoteWorkArrangement,
} from "@/lib/attendance-mode";
import HrPayrollShell from "../hr-payroll-shell";
import RemoteWorkArrangementsManager, {
  type ArrangementStaffOption,
} from "../remote-work-arrangements-manager";

export default async function RemoteWorkArrangementsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, role, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getCurrentUserRole(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId) {
    return (
      <HrPayrollShell sectionTitle="Remote Work Arrangements">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Unable to resolve your workspace.
        </p>
      </HrPayrollShell>
    );
  }

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const { staffIds, error: staffScopeError } = await fetchScopedStaffIds(
    supabase,
    tenantId,
    buScope,
  );

  const [employeesResult, arrangementsResult] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("employees")
        .select("staff_id, full_name, employment_status")
        .eq("tenant_id", tenantId)
        .eq("employment_status", "Active"),
      buScope,
    ).order("staff_id", { ascending: true }),
    applyStaffIdScope(
      supabase
        .from("remote_work_arrangements")
        .select(ARRANGEMENT_COLUMNS)
        .eq("tenant_id", tenantId),
      staffIds,
    ).order("start_date", { ascending: false }),
  ]);

  const loadError =
    staffScopeError ??
    employeesResult.error?.message ??
    arrangementsResult.error?.message ??
    null;

  const staff: ArrangementStaffOption[] = (
    (employeesResult.data as Array<
      ArrangementStaffOption & { employment_status?: string | null }
    > | null) ?? []
  ).map(({ staff_id, full_name }) => ({ staff_id, full_name }));

  return (
    <HrPayrollShell sectionTitle="Remote Work Arrangements">
      <RemoteWorkArrangementsManager
        tenantId={tenantId}
        staff={staff}
        initialArrangements={
          (arrangementsResult.data as RemoteWorkArrangement[] | null) ?? []
        }
        canEdit={canManageRemoteWorkArrangements(role)}
        loadError={loadError}
      />
    </HrPayrollShell>
  );
}
