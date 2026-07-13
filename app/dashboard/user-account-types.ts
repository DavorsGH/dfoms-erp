export type UserAccount = {
  auth_uid: string;
  employee_id: string;
  email: string;
  role: string;
  is_active: boolean;
  full_name: string;
};

export const USER_ROLE_OPTIONS = [
  { value: "super_admin", label: "Admin" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "operations_manager", label: "Operations" },
  { value: "supervisor", label: "Supervisor" },
  { value: "employee", label: "Employee" },
] as const;
