import "server-only";

import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";

export async function getPendingApprovals(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }

  const { authUid } = sessionResult.session;

  try {
    const supabase = await getStaffSupabase();
    const { data, error } = await supabase
      .from("leave_requests")
      .select(
        "start_date, end_date, days_requested, submitted_at, leave_types(type_name), employees!leave_requests_employee_id_fkey(full_name)",
      )
      .eq("status", "Pending")
      .eq("approver_user_account_id", authUid)
      .order("submitted_at", { ascending: true })
      .limit(LIST_LIMIT);

    if (error) {
      console.error("[assistant] get_pending_approvals failed:", error.message);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const leaveRequests = (data ?? []).map((row) => {
      const leaveType = Array.isArray(row.leave_types)
        ? row.leave_types[0]
        : row.leave_types;
      const employee = Array.isArray(row.employees)
        ? row.employees[0]
        : row.employees;

      return {
        type: "leave_request" as const,
        employeeName: employee?.full_name?.trim() || "Employee",
        leaveType: leaveType?.type_name?.trim() || "Leave",
        startDate: row.start_date,
        endDate: row.end_date,
        daysRequested: Number(row.days_requested) || 0,
        submittedAt: row.submitted_at,
      };
    });

    return {
      totalCount: leaveRequests.length,
      leaveRequests,
      note:
        leaveRequests.length === 0
          ? "No pending leave requests are assigned to you right now."
          : undefined,
    };
  } catch (error) {
    console.error("[assistant] get_pending_approvals threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
