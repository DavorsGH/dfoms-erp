import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeAudienceFilter,
  type EmployeeAnnouncementAudienceFilter,
} from "@/utils/employee-announcements-types";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

export const ANNOUNCEMENT_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, email, phone, position, shift, employment_type, employment_status" as const;

export type AnnouncementEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  first_name?: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  shift: string | null;
  employment_type: string | null;
  employment_status: string | null;
};

const ALL_BU_SCOPE: BusinessUnitReadScope = { mode: "all" };

/** Active employees: blank status treated as active (matches isActiveEmployee). */
function applyActiveEmployeeFilter<T extends { or: (filters: string) => T }>(
  query: T,
): T {
  return query.or(
    "employment_status.is.null,employment_status.ilike.Active",
  );
}

function mergeEmployees(
  into: Map<string, AnnouncementEmployee>,
  rows: AnnouncementEmployee[],
) {
  for (const row of rows) {
    into.set(row.employee_id, row);
  }
}

async function fetchActiveEmployeesByColumn(
  supabase: SupabaseClient,
  tenantId: string,
  column: "position" | "shift" | "employment_type" | "employee_id",
  values: string[],
  buScope: BusinessUnitReadScope,
): Promise<AnnouncementEmployee[]> {
  if (values.length === 0) return [];

  let query = applyBusinessUnitScope(
    supabase
      .from("employees")
      .select(ANNOUNCEMENT_EMPLOYEE_SELECT)
      .eq("tenant_id", tenantId)
      .in(column, values),
    buScope,
  );

  query = applyActiveEmployeeFilter(query);

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return (data as AnnouncementEmployee[] | null) ?? [];
}

function coerceAudience(
  audience: EmployeeAnnouncementAudienceFilter | unknown,
): EmployeeAnnouncementAudienceFilter {
  return (
    normalizeAudienceFilter(audience) ??
    (audience as EmployeeAnnouncementAudienceFilter)
  );
}

/**
 * Label for the "all employees" audience radio.
 * View-all / missing name → "All employees"; else scoped to the unit name.
 */
export function announcementAllEmployeesLabel(args: {
  viewAllBusinessUnits: boolean;
  businessUnitName: string | null | undefined;
}): string {
  const name = args.businessUnitName?.trim() ?? "";
  if (args.viewAllBusinessUnits || !name) {
    return "All employees";
  }
  return `All employees in ${name}`;
}

/**
 * Resolve audience employees.
 * `filtered` = OR-union of positions ∪ shifts ∪ employment_types ∪ employee_ids,
 * de-duplicated by employee_id. Legacy shapes are normalized first.
 */
export async function loadAnnouncementEmployees(
  supabase: SupabaseClient,
  tenantId: string,
  audienceInput: EmployeeAnnouncementAudienceFilter | unknown,
  buScope: BusinessUnitReadScope = ALL_BU_SCOPE,
): Promise<AnnouncementEmployee[]> {
  const audience = coerceAudience(audienceInput);

  if (audience.type === "all") {
    let query = applyBusinessUnitScope(
      supabase
        .from("employees")
        .select(ANNOUNCEMENT_EMPLOYEE_SELECT)
        .eq("tenant_id", tenantId)
        .order("full_name", { ascending: true }),
      buScope,
    );
    query = applyActiveEmployeeFilter(query);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as AnnouncementEmployee[] | null) ?? [];
  }

  if (audience.type !== "filtered") {
    return [];
  }

  const byId = new Map<string, AnnouncementEmployee>();

  const [byPosition, byShift, byEmploymentType, byIndividual] =
    await Promise.all([
      fetchActiveEmployeesByColumn(
        supabase,
        tenantId,
        "position",
        audience.positions,
        buScope,
      ),
      fetchActiveEmployeesByColumn(
        supabase,
        tenantId,
        "shift",
        audience.shifts,
        buScope,
      ),
      fetchActiveEmployeesByColumn(
        supabase,
        tenantId,
        "employment_type",
        audience.employment_types,
        buScope,
      ),
      fetchActiveEmployeesByColumn(
        supabase,
        tenantId,
        "employee_id",
        audience.employee_ids,
        buScope,
      ),
    ]);

  mergeEmployees(byId, byPosition);
  mergeEmployees(byId, byShift);
  mergeEmployees(byId, byEmploymentType);
  mergeEmployees(byId, byIndividual);

  return [...byId.values()].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }),
  );
}

export async function countEmployeeAudienceRecipients(
  supabase: SupabaseClient,
  tenantId: string,
  audienceInput: EmployeeAnnouncementAudienceFilter | unknown,
  buScope: BusinessUnitReadScope = ALL_BU_SCOPE,
): Promise<number> {
  const audience = coerceAudience(audienceInput);

  if (audience.type === "all") {
    let query = applyBusinessUnitScope(
      supabase
        .from("employees")
        .select("employee_id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      buScope,
    );
    query = applyActiveEmployeeFilter(query);
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

  try {
    const employees = await loadAnnouncementEmployees(
      supabase,
      tenantId,
      audience,
      buScope,
    );
    return employees.length;
  } catch (error) {
    console.error(
      "[employee-announcements] audience count failed:",
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}
