/**
 * Pure helpers for Ask DavSuite R55 staff tools (safe for tsx unit tests).
 * Keep free of server-only / Next.js imports.
 */

import type { AppRole } from "@/app/dashboard/user-account-types";
import { isAttendanceMode } from "@/lib/attendance-mode";
import {
  canAccessCrmSection,
  canAccessHrManagementSection,
  canAccessHrPayrollSection,
  canAccessPosSection,
  canResolvePaystackAttention,
  canViewAttendanceExceptions,
  PRODUCT_SALE_PAYSTACK_ROLES,
} from "@/utils/rbac-access";

export const SHIFT_TIMES_ASSISTANT_ROLES: readonly AppRole[] = [
  "super_admin",
  "director",
  "hr",
  "operations_manager",
  "finance_admin",
];

export function canAccessShiftTimesAssistant(
  role: AppRole | null | undefined,
): boolean {
  return (SHIFT_TIMES_ASSISTANT_ROLES as readonly string[]).includes(role ?? "");
}

export function canCollectPaystackPayments(
  role: AppRole | null | undefined,
): boolean {
  return (PRODUCT_SALE_PAYSTACK_ROLES as readonly string[]).includes(role ?? "");
}

export function canViewPaystackAttentionList(
  role: AppRole | null | undefined,
): boolean {
  return (
    canAccessCrmSection(role as AppRole | null) ||
    canResolvePaystackAttention(role)
  );
}

export function attendanceExceptionsAccessError(
  role: AppRole | null | undefined,
): string | null {
  if (!canViewAttendanceExceptions(role)) {
    return "You do not have access to attendance exceptions.";
  }
  return null;
}

export function employeeAttendanceModeAccessError(
  role: AppRole | null | undefined,
): string | null {
  if (!canAccessHrManagementSection(role as AppRole | null)) {
    return "You do not have access to employee attendance mode.";
  }
  return null;
}

export function remoteWorkArrangementsAccessError(
  role: AppRole | null | undefined,
): string | null {
  if (!canAccessHrPayrollSection(role as AppRole | null)) {
    return "You do not have access to remote work arrangements.";
  }
  return null;
}

export function shiftTimesAccessError(
  role: AppRole | null | undefined,
): string | null {
  if (!canAccessShiftTimesAssistant(role)) {
    return "You do not have access to shift times.";
  }
  return null;
}

export function payrollAbsenceSummaryAccessError(
  role: AppRole | null | undefined,
): string | null {
  if (!canAccessHrPayrollSection(role as AppRole | null)) {
    return "You do not have access to payroll absence summary.";
  }
  return null;
}

export function paystackPaymentsPendingAccessError(
  role: AppRole | null | undefined,
): string | null {
  if (
    !canCollectPaystackPayments(role) &&
    !canViewPaystackAttentionList(role)
  ) {
    return "You do not have access to Paystack payment status.";
  }
  return null;
}

export function mobileMoneyStatusAccessError(
  role: AppRole | null | undefined,
): string | null {
  if (
    !canAccessCrmSection(role as AppRole | null) &&
    !canAccessPosSection(role as AppRole | null)
  ) {
    return "You do not have access to Mobile Money collection status.";
  }
  return null;
}

export type AttendanceExceptionsView = "pending" | "decided" | "all";

export function parseAttendanceExceptionsView(
  toolInput: unknown,
): AttendanceExceptionsView {
  if (!toolInput || typeof toolInput !== "object") {
    return "pending";
  }
  const view = (toolInput as Record<string, unknown>).view;
  if (view === "decided" || view === "all" || view === "pending") {
    return view;
  }
  return "pending";
}

/** True when employees.attendance_mode is null/empty/invalid → role default applies. */
export function isAttendanceModeUsingRoleDefault(
  stored: string | null | undefined,
): boolean {
  return !isAttendanceMode(stored?.trim());
}

/** Relative age for pending/attention rows (pure — unit-testable). */
export function formatPaystackPaymentAge(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): { ageLabel: string; ageHours: number | null } {
  if (!createdAt?.trim()) {
    return { ageLabel: "unknown", ageHours: null };
  }
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) {
    return { ageLabel: "unknown", ageHours: null };
  }
  const ms = Math.max(0, now.getTime() - created.getTime());
  const ageHours = Math.round((ms / (60 * 60 * 1000)) * 10) / 10;
  if (ageHours < 1) {
    const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
    return { ageLabel: `${minutes}m`, ageHours };
  }
  if (ageHours < 48) {
    return { ageLabel: `${ageHours}h`, ageHours };
  }
  const days = Math.round(ageHours / 24);
  return { ageLabel: `${days}d`, ageHours };
}
