/**
 * Read-path payroll BU scoping via employees.business_unit_id.
 * Also resolves the employee-id set used by lock / release / reopen
 * (same switcher-gated BU context — not a separate majority vote).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

export type ScopedEmployeeIdsResult = {
  /** null = All Businesses — do not filter payroll by employee. */
  employeeIds: string[] | null;
  error: string | null;
};

/**
 * Resolve employee_id values for the active business-unit read scope.
 * - all → null (caller skips .in filter)
 * - default → employees with business_unit_id IS NULL
 * - unit → employees with that business_unit_id
 */
export async function fetchScopedEmployeeIds(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<ScopedEmployeeIdsResult> {
  if (buScope.mode === "all") {
    return { employeeIds: null, error: null };
  }

  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("employees")
      .select("employee_id")
      .eq("tenant_id", tenantId),
    buScope,
  );

  if (error) {
    return { employeeIds: [], error: error.message };
  }

  const ids = [
    ...new Set(
      ((data as Array<{ employee_id: string | null }> | null) ?? [])
        .map((row) => String(row.employee_id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  return { employeeIds: ids, error: null };
}

/**
 * Apply employee_id IN filter when scoped. Empty id list → force no rows
 * (PostgREST treats `.in(_, [])` inconsistently).
 */
export function applyEmployeeIdScope<T>(
  query: T,
  employeeIds: string[] | null,
): T {
  if (employeeIds === null) {
    return query;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  if (employeeIds.length === 0) {
    // Match nothing without relying on empty `.in()` behaviour.
    return q.eq("employee_id", "__no_scoped_employees__") as T;
  }
  return q.in("employee_id", employeeIds) as T;
}

/**
 * Same as applyEmployeeIdScope, but for FK columns that store employees.employee_id
 * under a different name (e.g. equipment_register.assigned_to).
 */
export function applyEmployeeIdScopeToColumn<T>(
  query: T,
  employeeIds: string[] | null,
  columnName: string,
): T {
  if (employeeIds === null) {
    return query;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  if (employeeIds.length === 0) {
    // Match nothing without relying on empty `.in()` behaviour.
    return q.eq(columnName, "__no_scoped_employees__") as T;
  }
  return q.in(columnName, employeeIds) as T;
}

export type ScopedStaffIdsResult = {
  /** null = All Businesses — do not filter by staff. */
  staffIds: string[] | null;
  error: string | null;
};

/**
 * Resolve staff_id values for the active business-unit read scope.
 * - all → null (caller skips .in filter)
 * - default → employees with business_unit_id IS NULL
 * - unit → employees with that business_unit_id
 */
export async function fetchScopedStaffIds(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<ScopedStaffIdsResult> {
  if (buScope.mode === "all") {
    return { staffIds: null, error: null };
  }

  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("employees")
      .select("staff_id")
      .eq("tenant_id", tenantId),
    buScope,
  );

  if (error) {
    return { staffIds: [], error: error.message };
  }

  const ids = [
    ...new Set(
      ((data as Array<{ staff_id: string | null }> | null) ?? [])
        .map((row) => String(row.staff_id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  return { staffIds: ids, error: null };
}

/**
 * Apply staff_id IN filter when scoped. Empty id list → force no rows
 * (PostgREST treats `.in(_, [])` inconsistently).
 */
export function applyStaffIdScope<T>(
  query: T,
  staffIds: string[] | null,
): T {
  if (staffIds === null) {
    return query;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  if (staffIds.length === 0) {
    // Match nothing without relying on empty `.in()` behaviour.
    return q.eq("staff_id", "__no_scoped_staff__") as T;
  }
  return q.in("staff_id", staffIds) as T;
}

/**
 * Employee ids for lock / release / reopen under the gated switcher BU.
 * Call only after assertLockBusinessUnitAllowed (All Businesses refused).
 */
export async function resolvePayrollPeriodScopedEmployeeIds(
  supabase: SupabaseClient,
  tenantId: string,
  businessUnitId: string | null,
): Promise<{ ok: true; employeeIds: string[] } | { ok: false; error: string }> {
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits: false,
    activeBusinessUnitId: businessUnitId,
  });
  const scoped = await fetchScopedEmployeeIds(supabase, tenantId, buScope);
  if (scoped.error) {
    return { ok: false, error: scoped.error };
  }
  const employeeIds = scoped.employeeIds ?? [];
  if (employeeIds.length === 0) {
    return {
      ok: false,
      error:
        "No employees in this business unit scope. Switch to the business that owns the staff for this period action.",
    };
  }
  return { ok: true, employeeIds };
}

/**
 * Reject (do not silently drop) when any row is outside the active employee scope.
 */
export function filterPayrollRowsToEmployeeScope<
  T extends { employee_id: string },
>(
  rows: T[],
  employeeIds: string[],
  emptyMessage = "No payroll rows in this business unit scope for this period",
): { ok: true; rows: T[] } | { ok: false; error: string } {
  const allowed = new Set(employeeIds);
  const outOfScope = rows.filter((row) => !allowed.has(String(row.employee_id)));
  if (outOfScope.length > 0) {
    return {
      ok: false,
      error: `${outOfScope.length} payroll row(s) are outside the active business unit employee scope. Switch to the correct business before continuing.`,
    };
  }
  if (rows.length === 0) {
    return { ok: false, error: emptyMessage };
  }
  return { ok: true, rows };
}
