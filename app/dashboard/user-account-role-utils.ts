import { USER_ROLE_OPTIONS, type AppRole } from "./user-account-types";

export type RoleAssignmentInput = {
  role: string;
  employee_id?: string | null;
  client_id?: string | null;
  supervisor_site_codes?: string[];
};

export type RoleAssignmentErrors = Partial<
  Record<"role" | "employee_id" | "client_id" | "supervisor_site_codes", string>
>;

const VALID_ROLES = new Set<string>(USER_ROLE_OPTIONS.map((option) => option.value));

export function isAppRole(value: string): value is AppRole {
  return VALID_ROLES.has(value);
}

export function validateRoleAssignment(
  input: RoleAssignmentInput,
): RoleAssignmentErrors {
  const errors: RoleAssignmentErrors = {};

  if (!input.role || !isAppRole(input.role)) {
    errors.role = "A valid role is required";
    return errors;
  }

  const employeeId = input.employee_id?.trim() || null;
  const clientId = input.client_id?.trim() || null;
  const siteCodes = (input.supervisor_site_codes ?? []).filter(Boolean);

  switch (input.role) {
    case "employee":
      if (!employeeId) {
        errors.employee_id = "Employee role requires an employee record";
      }
      break;
    case "client":
      if (!clientId) {
        errors.client_id = "Customer role requires a customer record";
      }
      break;
    case "supervisor":
      if (siteCodes.length === 0) {
        errors.supervisor_site_codes =
          "Supervisor role requires at least one site";
      }
      break;
    default:
      break;
  }

  return errors;
}

export function roleRequiresEmployee(role: AppRole): boolean {
  return role === "employee";
}

export function roleRequiresClient(role: AppRole): boolean {
  return role === "client";
}

export function roleRequiresSupervisorSites(role: AppRole): boolean {
  return role === "supervisor";
}

export function roleShowsEmployeePicker(role: AppRole): boolean {
  return role !== "client";
}
