import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentAuthUid } from "@/utils/dashboard-auth";
import LeaveApprovals from "./leave-approvals";
import type { LeaveRequest } from "../self-service/leave-request-utils";

export default async function LeaveApprovalsPage() {
  const authUid = await getCurrentAuthUid();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("leave_requests")
    .select("*, leave_types(type_name), employees!leave_requests_employee_id_fkey(full_name, staff_id)")
    .eq("status", "Pending")
    .eq("approver_user_account_id", authUid ?? "")
    .order("submitted_at", { ascending: true });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Pending Leave Requests
      </h1>
      <LeaveApprovals
        initialRequests={(data as LeaveRequest[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
