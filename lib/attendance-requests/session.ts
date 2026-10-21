import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticated } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  canAdministerAttendanceDevices,
  canSetAttendanceClockOut,
  canWriteAttendanceDevices,
  DEVICES_HUB_ROLES,
} from "@/utils/rbac-access";

export {
  canAdministerAttendanceDevices,
  canSetAttendanceClockOut,
  canWriteAttendanceDevices,
};

export type SessionActor = {
  authUid: string;
  tenantId: string;
  role: string;
  employeeId: string | null;
  staffId: string | null;
  fullName: string;
  remoteAttendanceAllowed: boolean;
  assignedSiteId: string | null;
  employmentType: string | null;
  contractProject: string | null;
};

export function isAttendanceHubRole(role: string | null | undefined): boolean {
  return (DEVICES_HUB_ROLES as readonly string[]).includes(role ?? "");
}

export async function requireSessionActor(): Promise<
  | { ok: true; actor: SessionActor; admin: SupabaseClient }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return { ok: false, response: auth.response };
  }
  if (!auth.userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Server is not configured for attendance requests." },
        { status: 500 },
      ),
    };
  }

  const { data: account, error } = await admin
    .from("user_accounts")
    .select("role, tenant_id, employee_id, is_active, email")
    .eq("auth_uid", auth.userId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }

  if (!account || account.is_active === false || !account.tenant_id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const actor: SessionActor = {
    authUid: auth.userId,
    tenantId: account.tenant_id,
    role: account.role,
    employeeId: account.employee_id ?? null,
    staffId: null,
    fullName: account.email?.trim() || "User",
    remoteAttendanceAllowed: false,
    assignedSiteId: null,
    employmentType: null,
    contractProject: null,
  };

  if (account.employee_id) {
    const { data: employee } = await admin
      .from("employees")
      .select(
        "staff_id, full_name, remote_attendance_allowed, assigned_site_id, employment_type, contract_project",
      )
      .eq("tenant_id", actor.tenantId)
      .eq("employee_id", account.employee_id)
      .maybeSingle();

    if (employee) {
      actor.staffId = employee.staff_id ?? null;
      actor.fullName = employee.full_name?.trim() || actor.fullName;
      actor.remoteAttendanceAllowed = employee.remote_attendance_allowed === true;
      actor.assignedSiteId = employee.assigned_site_id ?? null;
      actor.employmentType = employee.employment_type ?? null;
      actor.contractProject = employee.contract_project ?? null;
    }
  }

  return { ok: true, actor, admin };
}
