import type { SupabaseClient } from "@supabase/supabase-js";
import {
  audienceEmployeeIds,
  type EmployeeAnnouncementAudienceFilter,
} from "@/utils/employee-announcements-types";

/** Active employees: blank status treated as active (matches isActiveEmployee). */
function applyActiveEmployeeFilter<T extends { or: (filters: string) => T }>(
  query: T,
): T {
  return query.or(
    "employment_status.is.null,employment_status.ilike.Active",
  );
}

export async function countEmployeeAudienceRecipients(
  supabase: SupabaseClient,
  tenantId: string,
  audience: EmployeeAnnouncementAudienceFilter,
): Promise<number> {
  let query = supabase
    .from("employees")
    .select("employee_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  query = applyActiveEmployeeFilter(query);

  if (audience.type === "position") {
    query = query.eq("position", audience.value);
  } else if (audience.type === "shift") {
    query = query.eq("shift", audience.value);
  } else if (audience.type === "employment_type") {
    query = query.eq("employment_type", audience.value);
  } else if (audience.type === "individual") {
    const ids = audienceEmployeeIds(audience);
    if (ids.length === 0) {
      return 0;
    }
    query = query.in("employee_id", ids);
  }

  const { count, error } = await query;
  if (error) {
    console.error(
      "[employee-announcements] audience count failed:",
      error.message,
    );
    return 0;
  }

  return count ?? 0;
}
