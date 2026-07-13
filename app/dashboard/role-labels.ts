const ROLE_LABELS: Record<string, string> = {
  super_admin: "Admin",
  finance: "Finance",
  hr: "HR",
  operations_manager: "Operations",
  supervisor: "Supervisor",
  employee: "Employee",
};

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
