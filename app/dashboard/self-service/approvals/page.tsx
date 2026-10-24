import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentAuthUid,
  getCurrentUserTenantId,
  hasAttendanceApprovalInbox,
  hasLeaveApprovalInbox,
} from "@/utils/dashboard-auth";
import { buildLeaveEmployeeNameLookup } from "@/app/dashboard/self-service/leave-employee-display";
import type { LeaveRequest } from "@/app/dashboard/self-service/leave-request-utils";
import ApprovalsHub, {
  type ApprovalsTab,
} from "./approvals-hub";

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function SelfServiceApprovalsPage({
  searchParams,
}: PageProps) {
  const [showLeaveTab, showAttendanceTab, params] = await Promise.all([
    hasLeaveApprovalInbox(),
    hasAttendanceApprovalInbox(),
    searchParams,
  ]);

  if (!showLeaveTab && !showAttendanceTab) {
    redirect("/dashboard");
  }

  const requested =
    params.tab === "attendance"
      ? "attendance"
      : params.tab === "leave"
        ? "leave"
        : null;
  const initialTab: ApprovalsTab =
    requested === "attendance" && showAttendanceTab
      ? "attendance"
      : requested === "leave" && showLeaveTab
        ? "leave"
        : showLeaveTab
          ? "leave"
          : "attendance";

  const authUid = await getCurrentAuthUid();
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  let leaveInitialRequests: LeaveRequest[] = [];
  let leaveFetchError: string | null = null;
  let leaveEmployeeNames: Record<string, string> = {};

  if (showLeaveTab) {
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
    leaveInitialRequests = (data as LeaveRequest[] | null) ?? [];
    leaveFetchError = error?.message ?? null;
    leaveEmployeeNames = buildLeaveEmployeeNameLookup(employeeRows ?? []);
  }

  return (
    <Suspense fallback={<p className="text-sm text-slate-600">Loading approvals…</p>}>
      <ApprovalsHub
        showLeaveTab={showLeaveTab}
        showAttendanceTab={showAttendanceTab}
        initialTab={initialTab}
        leaveApproverAuthUid={authUid}
        leaveTenantId={tenantId}
        leaveEmployeeNames={leaveEmployeeNames}
        leaveInitialRequests={leaveInitialRequests}
        leaveFetchError={leaveFetchError}
      />
    </Suspense>
  );
}
