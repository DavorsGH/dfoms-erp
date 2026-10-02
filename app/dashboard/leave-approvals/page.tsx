import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentAuthUid, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { buildLeaveEmployeeNameLookup } from "../self-service/leave-employee-display";
import LeaveApprovals from "./leave-approvals";
import type { LeaveRequest } from "../self-service/leave-request-utils";

export default async function LeaveApprovalsPage() {
  const authUid = await getCurrentAuthUid();
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employeeRows }] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("*, leave_types(type_name)")
      .eq("status", "Pending")
      .eq("approver_user_account_id", authUid ?? "")
      .order("submitted_at", { ascending: true }),
    tenantId
      ? supabase
          .from("employees")
          .select("employee_id, full_name")
          .eq("tenant_id", tenantId)
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Pending Leave Requests
      </h1>
      <LeaveApprovals
        approverAuthUid={authUid}
        tenantId={tenantId}
        initialEmployeeNames={buildLeaveEmployeeNameLookup(employeeRows ?? [])}
        initialRequests={(data as LeaveRequest[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
