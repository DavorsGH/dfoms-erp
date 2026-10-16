/** Shared Director's Scorecard checklist helpers (dashboard + assistant tool). */

export const DIRECTOR_SCORECARD_PAYROLL_FOUND_EPSILON = 0.005;

export const DIRECTOR_SCORECARD_CASH_CHECKLIST_IDS = new Set([
  "cash-reserve",
  "dividend-cash",
]);

export function isDirectorScorecardPayrollMissing(payrollCost: number): boolean {
  return payrollCost <= DIRECTOR_SCORECARD_PAYROLL_FOUND_EPSILON;
}

export function directorScorecardPayrollNotFoundMessage(
  periodLabel: string,
  businessUnitLabel: string,
): string {
  return `Payroll was not found for ${periodLabel} in ${businessUnitLabel}. Check the business unit in the header or that payroll has been processed.`;
}

export function directorScorecardChecklistStatusLabel(
  chipStatus: "done" | "todo" | "overdue" | "not-enough-data",
): string {
  switch (chipStatus) {
    case "done":
      return "Done";
    case "overdue":
      return "Overdue";
    case "not-enough-data":
      return "Not enough data";
    case "todo":
    default:
      return "To do";
  }
}
