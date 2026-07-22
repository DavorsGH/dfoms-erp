import type { EmployeeRecord } from "../employees/employee-record-utils";

export type StaffIdCardEmployee = Pick<
  EmployeeRecord,
  | "employee_id"
  | "staff_id"
  | "full_name"
  | "photo_url"
  | "department"
  | "position"
  | "employment_status"
  | "department_ref"
>;

export const STAFF_ID_CARD_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, photo_url, department, position, employment_status, department_ref:departments!employees_department_fkey(dept_code, department_name)";
