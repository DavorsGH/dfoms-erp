import type { SupabaseClient } from "@supabase/supabase-js";

type AdminClient = SupabaseClient;

export type UserDeleteDependencyReport = {
  supervisorSiteCount: number;
  leaveApproverConfigCount: number;
  pendingLeaveApprovalCount: number;
  leaveRequestApproverCount: number;
  isCurrentLeaveApprover: boolean;
};

export type UserDeleteBlockReason =
  | "not_found"
  | "current_leave_approver"
  | "pending_leave_approvals"
  | "historical_leave_approvals_unassignable";

async function getCurrentLeaveApproverId(
  admin: AdminClient,
  tenantId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("leave_approver_config")
    .select("approver_user_account_id")
    .eq("tenant_id", tenantId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.approver_user_account_id ?? null;
}

export function formatUserDeleteDependencyReport(
  report: UserDeleteDependencyReport,
): string {
  const historicalApprovals =
    report.leaveRequestApproverCount - report.pendingLeaveApprovalCount;
  const parts = [
    `Supervisor site assignments: ${report.supervisorSiteCount}`,
    `Leave approver config rows: ${report.leaveApproverConfigCount}`,
    `Pending leave approvals: ${report.pendingLeaveApprovalCount}`,
    `Historical leave approvals: ${historicalApprovals}`,
  ];
  if (report.isCurrentLeaveApprover) {
    parts.push("This user is the current leave approver.");
  }
  return parts.join("\n");
}

export function getUserDeleteBlockMessage(
  reason: UserDeleteBlockReason,
  report?: UserDeleteDependencyReport,
): string {
  switch (reason) {
    case "not_found":
      return "User account not found.";
    case "current_leave_approver":
      return "This user is the current leave approver. Change the approver in Leave Settings before deleting this account.";
    case "pending_leave_approvals":
      return `This user is the approver on ${report?.pendingLeaveApprovalCount ?? 0} pending leave request(s). Reassign or resolve those requests before deleting the account.`;
    case "historical_leave_approvals_unassignable":
      return `This user is recorded as approver on ${(report?.leaveRequestApproverCount ?? 0) - (report?.pendingLeaveApprovalCount ?? 0)} historical leave request(s), but no other leave approver is configured to reassign them. Set a new leave approver first.`;
    default:
      return "This user account cannot be deleted.";
  }
}

export async function getUserDeleteDependencyReport(
  admin: AdminClient,
  authUid: string,
  tenantId: string,
): Promise<UserDeleteDependencyReport | null> {
  const { data: account } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!account) {
    return null;
  }

  const [
    { count: supervisorSiteCount },
    { count: leaveApproverConfigCount },
    { count: pendingLeaveApprovalCount },
    { count: leaveRequestApproverCount },
    { data: currentApproverConfig },
  ] = await Promise.all([
    admin
      .from("user_account_supervisor_sites")
      .select("site_code", { count: "exact", head: true })
      .eq("auth_uid", authUid)
      .eq("tenant_id", tenantId),
    admin
      .from("leave_approver_config")
      .select("id", { count: "exact", head: true })
      .eq("approver_user_account_id", authUid)
      .eq("tenant_id", tenantId),
    admin
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("approver_user_account_id", authUid)
      .eq("tenant_id", tenantId)
      .eq("status", "Pending"),
    admin
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("approver_user_account_id", authUid)
      .eq("tenant_id", tenantId),
    admin
      .from("leave_approver_config")
      .select("approver_user_account_id")
      .eq("tenant_id", tenantId)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    supervisorSiteCount: supervisorSiteCount ?? 0,
    leaveApproverConfigCount: leaveApproverConfigCount ?? 0,
    pendingLeaveApprovalCount: pendingLeaveApprovalCount ?? 0,
    leaveRequestApproverCount: leaveRequestApproverCount ?? 0,
    isCurrentLeaveApprover:
      currentApproverConfig?.approver_user_account_id === authUid,
  };
}

export async function validateUserCanBeDeleted(
  admin: AdminClient,
  authUid: string,
  tenantId: string,
): Promise<
  | { ok: true; report: UserDeleteDependencyReport }
  | { ok: false; reason: UserDeleteBlockReason; report?: UserDeleteDependencyReport }
> {
  const report = await getUserDeleteDependencyReport(admin, authUid, tenantId);
  if (!report) {
    return { ok: false, reason: "not_found" };
  }

  if (report.isCurrentLeaveApprover) {
    return { ok: false, reason: "current_leave_approver", report };
  }

  if (report.pendingLeaveApprovalCount > 0) {
    return { ok: false, reason: "pending_leave_approvals", report };
  }

  const historicalApprovalCount =
    report.leaveRequestApproverCount - report.pendingLeaveApprovalCount;
  if (historicalApprovalCount > 0) {
    const currentApproverId = await getCurrentLeaveApproverId(admin, tenantId);
    if (!currentApproverId || currentApproverId === authUid) {
      return {
        ok: false,
        reason: "historical_leave_approvals_unassignable",
        report,
      };
    }
  }

  return { ok: true, report };
}

export async function deleteUserAccount(
  admin: AdminClient,
  authUid: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const validation = await validateUserCanBeDeleted(admin, authUid, tenantId);
  if (!validation.ok) {
    return {
      ok: false,
      error: getUserDeleteBlockMessage(validation.reason, validation.report),
    };
  }

  const { data: account } = await admin
    .from("user_accounts")
    .select("auth_uid, employee_id, client_id")
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!account) {
    return { ok: false, error: "User account not found." };
  }

  const historicalApprovalCount =
    validation.report.leaveRequestApproverCount -
    validation.report.pendingLeaveApprovalCount;

  if (historicalApprovalCount > 0) {
    const currentApproverId = await getCurrentLeaveApproverId(admin, tenantId);
    if (!currentApproverId || currentApproverId === authUid) {
      return {
        ok: false,
        error: getUserDeleteBlockMessage(
          "historical_leave_approvals_unassignable",
          validation.report,
        ),
      };
    }

    const { error: reassignError } = await admin
      .from("leave_requests")
      .update({ approver_user_account_id: currentApproverId })
      .eq("approver_user_account_id", authUid)
      .eq("tenant_id", tenantId)
      .neq("status", "Pending");

    if (reassignError) {
      return { ok: false, error: reassignError.message };
    }
  }

  await admin
    .from("user_account_supervisor_sites")
    .delete()
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId);

  if (validation.report.leaveApproverConfigCount > 0) {
    const { error: configDeleteError } = await admin
      .from("leave_approver_config")
      .delete()
      .eq("approver_user_account_id", authUid)
      .eq("tenant_id", tenantId);

    if (configDeleteError) {
      return { ok: false, error: configDeleteError.message };
    }
  }

  const { error: accountDeleteError } = await admin
    .from("user_accounts")
    .delete()
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId);

  if (accountDeleteError) {
    return { ok: false, error: accountDeleteError.message };
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(authUid);
  if (authDeleteError) {
    return {
      ok: false,
      error: `App account removed but auth user deletion failed: ${authDeleteError.message}`,
    };
  }

  return { ok: true };
}
