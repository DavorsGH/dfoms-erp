import {
  getPeriodEndDate,
  getPeriodStartDate,
} from "./payroll-period-utils";

export type HrEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  employment_type: string | null;
  contract_project: string | null;
  employment_status?: string | null;
  date_hired?: string | null;
  appointment_end_date?: string | null;
};

export const HR_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, employment_type, contract_project, employment_status, date_hired, appointment_end_date";

export type PeriodEmployableEmployee = {
  date_hired: string | null;
  appointment_end_date: string | null;
};

/** Uses today's employment_status — not valid for historical payroll periods. */
export function isActiveEmployee(employee: HrEmployee): boolean {
  const status = employee.employment_status?.trim().toLowerCase();

  if (!status) {
    return true;
  }

  return status === "active";
}

/** Uses today's employment_status — not valid for historical payroll periods. */
export function filterActiveEmployees(employees: HrEmployee[]): HrEmployee[] {
  return employees.filter(isActiveEmployee);
}

export function wasEmployedDuringPayrollPeriod(
  employee: PeriodEmployableEmployee,
  year: number,
  month: number,
): boolean {
  const periodStart = getPeriodStartDate(year, month);
  const periodEnd = getPeriodEndDate(year, month);
  const dateHired = employee.date_hired?.slice(0, 10);

  if (!dateHired || dateHired > periodEnd) {
    return false;
  }

  const appointmentEnd = employee.appointment_end_date?.slice(0, 10);
  if (appointmentEnd && appointmentEnd < periodStart) {
    return false;
  }

  return true;
}

export function filterEmployeesForPayrollPeriod<
  T extends PeriodEmployableEmployee,
>(employees: T[], year: number, month: number): T[] {
  return employees.filter((employee) =>
    wasEmployedDuringPayrollPeriod(employee, year, month),
  );
}

export function getEmployeeByStaffId(
  employees: HrEmployee[],
  staffId: string,
): HrEmployee | undefined {
  return employees.find((employee) => employee.staff_id === staffId);
}

export function getEmployeeById(
  employees: HrEmployee[],
  employeeId: string,
): HrEmployee | undefined {
  return employees.find((employee) => employee.employee_id === employeeId);
}

export function getEmployeeDisplayName(
  employees: HrEmployee[],
  employeeId: string,
): string {
  return getEmployeeById(employees, employeeId)?.full_name ?? employeeId;
}
