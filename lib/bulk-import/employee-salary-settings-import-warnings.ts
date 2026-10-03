export const EMPLOYEE_MISSING_SALARY_RATE_WARNING_PREFIX =
  "No salary rate in Salary Settings for ";

export const EMPLOYEE_MISSING_SALARY_RATE_REVIEW_GROUP_LABEL =
  "No salary rate set up";

export function formatEmployeeMissingSalaryRateWarning(
  position: string,
  employmentType: string,
  shift: string,
): string {
  return `${EMPLOYEE_MISSING_SALARY_RATE_WARNING_PREFIX}${position} / ${employmentType} / ${shift} — this employee will have no basic pay until one is added.`;
}

export function isEmployeeMissingSalaryRateWarning(message: string): boolean {
  return message.trim().startsWith(EMPLOYEE_MISSING_SALARY_RATE_WARNING_PREFIX);
}
