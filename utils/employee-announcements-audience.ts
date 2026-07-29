import type { SupabaseClient } from "@supabase/supabase-js";
import {
  audienceEmployeeIds,
  type EmployeeAnnouncementAudienceFilter,
} from "@/utils/employee-announcements-types";

export const ANNOUNCEMENT_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, email, phone, position, shift, employment_type, employment_status" as const;

export type AnnouncementEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  shift: string | null;
  employment_type: string | null;
  employment_status: string | null;
};

/** Active employees: blank status treated as active (matches isActiveEmployee). */
function applyActiveEmployeeFilter<T extends { or: (filters: string) => T }>(
  query: T,
): T {
  return query.or(
    "employment_status.is.null,employment_status.ilike.Active",
  );
}

function applyAudienceFilter<
  T extends {
    eq: (column: string, value: string) => T;
    in: (column: string, values: string[]) => T;
  },
>(query: T, audience: EmployeeAnnouncementAudienceFilter): T | null {
  if (audience.type === "position") {
    return query.eq("position", audience.value);
  }
  if (audience.type === "shift") {
    return query.eq("shift", audience.value);
  }
  if (audience.type === "employment_type") {
    return query.eq("employment_type", audience.value);
  }
  if (audience.type === "individual") {
    const ids = audienceEmployeeIds(audience);
    if (ids.length === 0) {
      return null;
    }
    return query.in("employee_id", ids);
  }
  return query;
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
  const filtered = applyAudienceFilter(query, audience);
  if (!filtered) {
    return 0;
  }

  const { count, error } = await filtered;
  if (error) {
    console.error(
      "[employee-announcements] audience count failed:",
      error.message,
    );
    return 0;
  }

  return count ?? 0;
}

export async function loadAnnouncementEmployees(
  supabase: SupabaseClient,
  tenantId: string,
  audience: EmployeeAnnouncementAudienceFilter,
): Promise<AnnouncementEmployee[]> {
  let query = supabase
    .from("employees")
    .select(ANNOUNCEMENT_EMPLOYEE_SELECT)
    .eq("tenant_id", tenantId)
    .order("full_name", { ascending: true });

  query = applyActiveEmployeeFilter(query);
  const filtered = applyAudienceFilter(query, audience);
  if (!filtered) {
    return [];
  }

  const { data, error } = await filtered;
  if (error) {
    throw new Error(error.message);
  }

  return (data as AnnouncementEmployee[] | null) ?? [];
}
