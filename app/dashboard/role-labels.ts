import type { AppRole } from "./user-account-types";

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Admin",
  finance: "Finance",
  hr: "HR",
  operations_manager: "Operations",
  supervisor: "Supervisor",
  employee: "Employee",
  client: "Client",
  sales_rep: "Sales Rep",
};

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role as AppRole] ?? role;
}
