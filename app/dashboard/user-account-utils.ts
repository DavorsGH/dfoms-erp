import type { UserAccount } from "./user-account-types";

type UserAccountRow = {
  auth_uid: string;
  employee_id: string;
  email: string;
  role: string;
  is_active: boolean;
  employees: { full_name: string } | { full_name: string }[] | null;
};

export function mapUserAccountRows(rows: UserAccountRow[]): UserAccount[] {
  return rows.map((row) => {
    const employee = row.employees;
    const fullName = Array.isArray(employee)
      ? (employee[0]?.full_name ?? row.employee_id)
      : (employee?.full_name ?? row.employee_id);

    return {
      auth_uid: row.auth_uid,
      employee_id: row.employee_id,
      email: row.email,
      role: row.role,
      is_active: row.is_active,
      full_name: fullName,
    };
  });
}
