import {
  getPeriodEndDate,
  PAYROLL_STATUS_LOCKED,
} from "@/app/dashboard/hr-payroll/payroll-period-utils";
import { pendingExceptionLockRefusal } from "@/lib/shift-attendance";
import { formatDate } from "@/app/dashboard/finance/income-register-utils";

export function payrollTodayIso(reference = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
}

/** Null when the month has ended. The date is the last calendar day of the period. */
export function permanentLockMonthEndMessage(
  year: number,
  month: number,
  todayIso: string,
): string | null {
  const end = getPeriodEndDate(year, month);
  if (todayIso.slice(0, 10) >= end) {
    return null;
  }
  return `Permanent lock is available on or after ${formatDate(end)}.`;
}

export type FullLockServerBlock =
  | { status: 400; error: string }
  | {
      status: 409;
      error: string;
      pendingExceptionCount: number;
      exceptionsHref: string;
    };

/**
 * Permanent lock only. Month-end first, then pending exceptions.
 * Year and month come from the body when present, otherwise from payrollMonth,
 * so a direct request cannot skip the month-end rule by omitting them.
 */
export function fullLockServerBlock(input: {
  lockStatus: string;
  payrollMonth: string;
  periodYear?: number | null;
  periodMonth?: number | null;
  todayIso: string;
  pendingExceptionCount: number;
}): FullLockServerBlock | null {
  if (input.lockStatus !== PAYROLL_STATUS_LOCKED) {
    return null;
  }
  const year =
    input.periodYear && input.periodYear > 0
      ? input.periodYear
      : Number(input.payrollMonth.slice(0, 4));
  const month =
    input.periodMonth && input.periodMonth > 0
      ? input.periodMonth
      : Number(input.payrollMonth.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { status: 400, error: "payrollMonth is required" };
  }
  const monthEnd = permanentLockMonthEndMessage(year, month, input.todayIso);
  if (monthEnd) {
    return { status: 400, error: monthEnd };
  }
  const pending = pendingExceptionLockRefusal(input.pendingExceptionCount, {
    year,
    month,
  });
  if (!pending) {
    return null;
  }
  return {
    status: 409,
    error: pending.error,
    pendingExceptionCount: pending.pendingExceptionCount,
    exceptionsHref: pending.exceptionsHref,
  };
}
