export type AppRole =
  | "super_admin"
  | "finance"
  | "hr"
  | "operations_manager"
  | "supervisor"
  | "employee"
  | "client"
  | "sales_rep";

export type UserAccount = {
  auth_uid: string;
  employee_id: string | null;
  email: string;
  role: AppRole;
  is_active: boolean;
  full_name: string;
  client_id: string | null;
  client_name: string | null;
  supervisor_site_codes: string[];
};

export const USER_ROLE_OPTIONS: ReadonlyArray<{
  value: AppRole;
  label: string;
}> = [
  { value: "super_admin", label: "Admin" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "operations_manager", label: "Operations" },
  { value: "supervisor", label: "Supervisor" },
  { value: "employee", label: "Employee" },
  { value: "client", label: "Client" },
  { value: "sales_rep", label: "Sales Rep" },
];

export type SiteOption = {
  site_code: string;
  site_name: string;
};

export type ClientOption = {
  client_id: string;
  client_name: string;
};
