import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ARRANGEMENT_COLUMNS,
  arrangementsForTenant,
  resolveAttendanceMode,
  type AttendanceMode,
  type RemoteWorkArrangement,
} from "@/lib/attendance-mode";

/**
 * Loaders take the Supabase client as a parameter and always filter by
 * tenant_id. Use the service-role client on the server; a user client works
 * when RLS allows the reads (user_accounts may hide roles, in which case only
 * explicit employee overrides resolve).
 */
/** Active arrangements for one staff member in one tenant. */
export async function loadArrangementsForStaff(
  admin: SupabaseClient,
  tenantId: string,
  staffId: string,
): Promise<RemoteWorkArrangement[]> {
  const { data, error } = await admin
    .from("remote_work_arrangements")
    .select(ARRANGEMENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("staff_id", staffId)
    .eq("is_active", true);
  if (error) {
    throw new Error(error.message);
  }
  return arrangementsForTenant(
    (data ?? []) as RemoteWorkArrangement[],
    tenantId,
  );
}

/** Resolved mode for one staff member (employee override, else linked user role). */
export async function loadAttendanceModeForStaff(
  admin: SupabaseClient,
  tenantId: string,
  staffId: string,
): Promise<AttendanceMode> {
  const modes = await loadAttendanceModesForStaff(admin, tenantId, [staffId]);
  return modes.get(staffId) ?? "standard";
}

/**
 * Resolved modes keyed by staff_id. Pass staffIds = null for every employee in
 * the tenant. Every query filters by tenant_id.
 */
export async function loadAttendanceModesForStaff(
  admin: SupabaseClient,
  tenantId: string,
  staffIds: readonly string[] | null,
): Promise<Map<string, AttendanceMode>> {
  const result = new Map<string, AttendanceMode>();
  if (staffIds && staffIds.length === 0) {
    return result;
  }

  let employeeQuery = admin
    .from("employees")
    .select("employee_id, staff_id, attendance_mode")
    .eq("tenant_id", tenantId);
  if (staffIds) {
    employeeQuery = employeeQuery.in("staff_id", [...staffIds]);
  }
  const { data: employees, error } = await employeeQuery;
  if (error) {
    throw new Error(error.message);
  }
  const rows = employees ?? [];
  if (rows.length === 0) {
    return result;
  }

  const employeeIds = rows
    .map((row) => row.employee_id as string | null)
    .filter((id): id is string => Boolean(id));
  const roleByEmployeeId = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: accounts } = await admin
      .from("user_accounts")
      .select("employee_id, role, is_active")
      .eq("tenant_id", tenantId)
      .in("employee_id", employeeIds);
    for (const account of accounts ?? []) {
      const employeeId = account.employee_id as string | null;
      if (!employeeId) {
        continue;
      }
      // Prefer an active account when an employee has more than one.
      if (account.is_active === false && roleByEmployeeId.has(employeeId)) {
        continue;
      }
      roleByEmployeeId.set(employeeId, account.role as string);
    }
  }

  for (const row of rows) {
    const staffId = row.staff_id as string | null;
    if (!staffId) {
      continue;
    }
    result.set(
      staffId,
      resolveAttendanceMode(
        { attendance_mode: row.attendance_mode as string | null },
        roleByEmployeeId.get(row.employee_id as string) ?? null,
      ),
    );
  }
  return result;
}

/** staff_ids that resolve to exempt in this tenant. */
export async function loadExemptStaffIds(
  admin: SupabaseClient,
  tenantId: string,
  staffIds: readonly string[] | null = null,
): Promise<string[]> {
  const modes = await loadAttendanceModesForStaff(admin, tenantId, staffIds);
  return [...modes.entries()]
    .filter(([, mode]) => mode === "exempt")
    .map(([staffId]) => staffId);
}
