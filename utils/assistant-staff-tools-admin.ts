import "server-only";

import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";

export async function getUserAccountSummary(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }

  if (sessionResult.session.role !== "super_admin") {
    return { error: "You do not have access to user account summary data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const { data, error } = await supabase
      .from("user_accounts")
      .select("role, is_active");

    if (error) {
      console.error("[assistant] get_user_account_summary failed:", error.message);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const byRole = new Map<AppRole, { active: number; inactive: number }>();
    for (const row of data ?? []) {
      const role = row.role as AppRole;
      const current = byRole.get(role) ?? { active: 0, inactive: 0 };
      if (row.is_active) {
        current.active += 1;
      } else {
        current.inactive += 1;
      }
      byRole.set(role, current);
    }

    const roles = [...byRole.entries()]
      .map(([role, counts]) => ({
        role,
        activeCount: counts.active,
        inactiveCount: counts.inactive,
      }))
      .sort((a, b) => a.role.localeCompare(b.role));

    const totalActive = roles.reduce((sum, row) => sum + row.activeCount, 0);
    const totalInactive = roles.reduce((sum, row) => sum + row.inactiveCount, 0);

    return {
      totalActive,
      totalInactive,
      byRole: roles,
    };
  } catch (error) {
    console.error("[assistant] get_user_account_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}