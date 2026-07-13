export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function toTimeInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.slice(0, 5);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const [hours, minutes] = value.slice(0, 5).split(":");
  if (!hours || !minutes) {
    return value;
  }

  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);

  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function generateNextSequentialId(
  prefix: string,
  existingIds: string[],
): string {
  const numbers = existingIds.map((id) => {
    const match = id.match(new RegExp(`^${prefix}(\\d+)$`, "i"));
    return match ? Number.parseInt(match[1], 10) : 0;
  });
  const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;

  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}

export function calculateDaysBetween(startDate: string, endDate: string): number {
  if (!startDate || !endDate) {
    return 0;
  }

  const start = new Date(startDate.slice(0, 10));
  const end = new Date(endDate.slice(0, 10));

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }

  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export function calculateHoursFromClock(
  clockIn: string,
  clockOut: string,
): number | null {
  if (!clockIn || !clockOut) {
    return null;
  }

  const [inHours, inMinutes] = clockIn.split(":").map(Number);
  const [outHours, outMinutes] = clockOut.split(":").map(Number);

  if (
    [inHours, inMinutes, outHours, outMinutes].some((value) => Number.isNaN(value))
  ) {
    return null;
  }

  let minutesWorked = outHours * 60 + outMinutes - (inHours * 60 + inMinutes);

  if (minutesWorked < 0) {
    minutesWorked += 24 * 60;
  }

  return Math.round((minutesWorked / 60) * 100) / 100;
}

export function calculateOvertimeAmount(
  overtimeHours: number,
  overtimeRate: number,
): number {
  return (Number(overtimeHours) || 0) * (Number(overtimeRate) || 0);
}

export function calculateLoanOutstanding(
  loanAmount: number,
  totalRepaid: number,
): number {
  return Math.max((Number(loanAmount) || 0) - (Number(totalRepaid) || 0), 0);
}

export function getLoanStatus(outstandingBalance: number): "Active" | "Fully Repaid" {
  return outstandingBalance <= 0.01 ? "Fully Repaid" : "Active";
}

export const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";
