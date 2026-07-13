export type HrEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  employment_type: string | null;
  contract_project: string | null;
  employment_status?: string | null;
};

export const HR_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, employment_type, contract_project, employment_status";

export function isActiveEmployee(employee: HrEmployee): boolean {
  const status = employee.employment_status?.trim().toLowerCase();

  if (!status) {
    return true;
  }

  return status === "active";
}

export function filterActiveEmployees(employees: HrEmployee[]): HrEmployee[] {
  return employees.filter(isActiveEmployee);
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
