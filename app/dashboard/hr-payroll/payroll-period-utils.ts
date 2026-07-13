export const PAYROLL_STATUS_NOT_STARTED = "Not Started";
export const PAYROLL_STATUS_OPEN = "Open";
export const PAYROLL_STATUS_LOCKED = "Locked";
export const PAYROLL_STATUS_PARTIALLY_LOCKED = "Partially Locked";

export type SelectedPayrollPeriod = {
  year: number;
  month: number;
  payrollMonth: string;
  totalWorkingDays: number;
};

export type PayrollPeriod = SelectedPayrollPeriod;

export type MonthEndCloseRecord = {
  month: string;
  employees_recorded: number | null;
  total_net_pay: number | null;
  lock_status: string | null;
  notes: string | null;
};

export function countMondayToSaturdayDays(
  year: number,
  month: number,
): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekday = new Date(year, month - 1, day).getDay();
    if (weekday >= 1 && weekday <= 6) {
      count += 1;
    }
  }

  return count;
}

export function getPeriodEndDate(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function getPeriodStartDate(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function formatPeriodLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function isDateInPayrollMonth(
  dateValue: string,
  year: number,
  month: number,
): boolean {
  const date = dateValue.slice(0, 10);
  return (
    date >= getPeriodStartDate(year, month) &&
    date <= getPeriodEndDate(year, month)
  );
}

export function buildPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parsePeriodKey(key: string): { year: number; month: number } | null {
  const match = key.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
  };
}

export function resolveSelectedPeriod(
  year: number,
  month: number,
): SelectedPayrollPeriod {
  return {
    year,
    month,
    payrollMonth: getPeriodStartDate(year, month),
    totalWorkingDays: countMondayToSaturdayDays(year, month),
  };
}

export function payrollMonthToPeriodKey(payrollMonth: string): string | null {
  const date = payrollMonth.slice(0, 10);
  const match = date.match(/^(\d{4})-(\d{2})/);
  if (!match) {
    return null;
  }

  return `${match[1]}-${match[2]}`;
}

export function normalizePayrollMonthValue(value: string): string {
  return value.slice(0, 10);
}

export function isMonthClosed(
  record: MonthEndCloseRecord | null | undefined,
): boolean {
  return (
    record?.lock_status === PAYROLL_STATUS_LOCKED ||
    record?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED
  );
}

/** @deprecated Use isMonthClosed */
export function isMonthLocked(
  record: MonthEndCloseRecord | null | undefined,
): boolean {
  return isMonthClosed(record);
}

export function isPartiallyLockedMonth(
  record: MonthEndCloseRecord | null | undefined,
): boolean {
  return record?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED;
}

export function findMonthEndCloseForKey(
  records: MonthEndCloseRecord[],
  periodKey: string,
): MonthEndCloseRecord | undefined {
  return records.find(
    (record) => payrollMonthToPeriodKey(record.month) === periodKey,
  );
}

export function getPeriodDisplayStatus(
  closeRecord: MonthEndCloseRecord | null | undefined,
  hasProcessingRows: boolean,
): string {
  if (closeRecord?.lock_status === PAYROLL_STATUS_LOCKED) {
    return PAYROLL_STATUS_LOCKED;
  }

  if (closeRecord?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED) {
    const note = closeRecord.notes?.trim();
    return note
      ? `${PAYROLL_STATUS_PARTIALLY_LOCKED} — ${note}`
      : PAYROLL_STATUS_PARTIALLY_LOCKED;
  }

  if (hasProcessingRows) {
    return PAYROLL_STATUS_OPEN;
  }

  return PAYROLL_STATUS_NOT_STARTED;
}

export function getPeriodSelectorLabel(
  year: number,
  month: number,
  closeRecord: MonthEndCloseRecord | null | undefined,
): string {
  const baseLabel = formatPeriodLabel(year, month);

  if (closeRecord?.lock_status === PAYROLL_STATUS_LOCKED) {
    return `${baseLabel} (Locked)`;
  }

  if (closeRecord?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED) {
    return `${baseLabel} (Partial)`;
  }

  return baseLabel;
}

export function isFullMonthPayrollLock(
  rows: { employee_id: string; days_to_pay: number | null }[],
  activeEmployeeIds: Set<string>,
  totalWorkingDays: number,
): boolean {
  if (activeEmployeeIds.size === 0) {
    return true;
  }

  const activeRows = rows.filter((row) => activeEmployeeIds.has(row.employee_id));

  if (activeRows.length !== activeEmployeeIds.size) {
    return false;
  }

  return activeRows.every((row) => {
    const daysToPay = Number(row.days_to_pay);
    return (
      Number.isFinite(daysToPay) &&
      Math.abs(daysToPay - totalWorkingDays) < 0.001
    );
  });
}
