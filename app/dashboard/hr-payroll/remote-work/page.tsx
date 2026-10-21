import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentUserRole,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
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
  const [tenantId, role] = await Promise.all([
    getCurrentUserTenantId(),
    getCurrentUserRole(),
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

  const [employeesResult, arrangementsResult] = await Promise.all([
    supabase
      .from("employees")
      .select("staff_id, full_name, employment_status")
      .eq("tenant_id", tenantId)
      .eq("employment_status", "Active")
      .order("staff_id", { ascending: true }),
    supabase
      .from("remote_work_arrangements")
      .select(ARRANGEMENT_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("start_date", { ascending: false }),
  ]);

  const loadError =
    employeesResult.error?.message ?? arrangementsResult.error?.message ?? null;

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
