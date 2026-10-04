import type { PostgrestError } from "@supabase/supabase-js";
import { formatEmployeesStillUseItClause } from "@/utils/delete-blocked-messaging";
import {
  extractPostgresForeignKeyConstraintName,
  isPostgresForeignKeyViolation,
  resolveDeleteErrorMessage,
} from "@/utils/postgres-fk-violation";

export function formatProjectDeleteBlockedByEmployeesMessage(
  assignedEmployeeCount: number,
): string {
  return `This contract/project can't be deleted because ${formatEmployeesStillUseItClause(assignedEmployeeCount)}. Deactivate it instead.`;
}

export const PROJECT_DELETE_BLOCKED_BY_EMPLOYEES_MESSAGE =
  "This contract/project still has employees assigned and can't be deleted. Deactivate it instead so it stops appearing for new assignments.";

export const PROJECT_DELETE_FK_MESSAGES: Record<string, string> = {
  employees_contract_project_fkey: PROJECT_DELETE_BLOCKED_BY_EMPLOYEES_MESSAGE,
  payroll_history_project_contract_fkey:
    "This contract/project appears in payroll history and can't be deleted. Deactivate it instead so it stops appearing for new assignments.",
  payroll_processing_project_contract_fkey:
    "This contract/project appears in open payroll processing and can't be deleted. Deactivate it instead so it stops appearing for new assignments.",
  sites_project_id_fkey:
    "This contract/project still has sites linked and can't be deleted. Reassign or remove those sites first, or deactivate the contract instead.",
};

export function extractForeignKeyConstraintName(
  message: string | null | undefined,
): string | null {
  return extractPostgresForeignKeyConstraintName(message);
}

export function isProjectDeleteForeignKeyError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!isPostgresForeignKeyViolation(error)) {
    return false;
  }

  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes("projects") ||
    message.includes("employees") ||
    message.includes("sites") ||
    message.includes("payroll")
  );
}

export function getProjectDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): string {
  return resolveDeleteErrorMessage(error, {
    constraintMessages: PROJECT_DELETE_FK_MESSAGES,
    fallbackInUseMessage:
      "This contract/project is linked to other records and can't be deleted. Deactivate it instead, or remove the linked records first.",
    fallbackNonFkMessage: "Unable to delete this contract/project. Try again.",
  });
}
