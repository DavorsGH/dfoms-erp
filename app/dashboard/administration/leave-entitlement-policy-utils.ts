/**
 * Leave entitlement policy — defaults by Position × Employment Type × Leave Type.
 * Fallback matches current product behavior: Annual Leave 15, Sick/Unpaid 0.
 * Forward-only: only used when creating new employee_leave_balances rows.
 */

export const LEAVE_ENTITLEMENT_TYPES = [
  "Annual Leave",
  "Sick Leave",
  "Unpaid Leave",
] as const;

export type LeaveEntitlementType = (typeof LEAVE_ENTITLEMENT_TYPES)[number];

export const LEAVE_ENTITLEMENT_EMPLOYMENT_TYPES = [
  "Casual",
  "Part-Time",
  "Full-Time",
  "Contract",
] as const;

export type LeaveEntitlementPolicyRow = {
  id: string;
  tenant_id?: string;
  position: string;
  employment_type: string;
  leave_type: string;
  entitled_days: number;
};

export type LeaveTypeCatalogRow = {
  id: string;
  type_name: string;
};

/** Fallback when no leave_entitlement_policy row exists (matches script 55 / seed). */
export function leaveEntitlementFallback(leaveType: string): number {
  return leaveType.trim() === "Annual Leave" ? 15 : 0;
}

export function resolveLeaveEntitlement(
  policies: LeaveEntitlementPolicyRow[],
  position: string | null | undefined,
  employmentType: string | null | undefined,
  leaveType: string,
): number {
  const pos = (position ?? "").trim();
  const emp = (employmentType ?? "").trim();
  const lt = leaveType.trim();

  if (pos && emp && lt) {
    const match = policies.find(
      (row) =>
        row.position === pos &&
        row.employment_type === emp &&
        row.leave_type === lt,
    );
    if (match) {
      return Math.round((Number(match.entitled_days) || 0) * 100) / 100;
    }
  }

  return leaveEntitlementFallback(lt);
}

/**
 * Build upsert payloads for all catalog leave types for one employee/year.
 * Does not overwrite existing rows when used with ON CONFLICT DO NOTHING /
 * ignoreDuplicates — callers must use insert-only semantics for forward-only.
 */
export function buildNewHireLeaveBalanceRows(input: {
  tenantId: string;
  employeeId: string;
  year: number;
  position: string | null | undefined;
  employmentType: string | null | undefined;
  leaveTypes: LeaveTypeCatalogRow[];
  policies: LeaveEntitlementPolicyRow[];
}): {
  tenant_id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  entitled_days: number;
  days_used: number;
}[] {
  return input.leaveTypes.map((lt) => ({
    tenant_id: input.tenantId,
    employee_id: input.employeeId,
    leave_type_id: lt.id,
    year: input.year,
    entitled_days: resolveLeaveEntitlement(
      input.policies,
      input.position,
      input.employmentType,
      lt.type_name,
    ),
    days_used: 0,
  }));
}
