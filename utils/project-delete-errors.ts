import type { PostgrestError } from "@supabase/supabase-js";

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

const FK_CONSTRAINT_NAME_PATTERN =
  /violates foreign key constraint "([^"]+)"/i;

export function extractForeignKeyConstraintName(
  message: string | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const match = message.match(FK_CONSTRAINT_NAME_PATTERN);
  return match?.[1] ?? null;
}

export function isProjectDeleteForeignKeyError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) {
    return false;
  }

  if (error.code === "23503") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("violates foreign key constraint") &&
    (message.includes("projects") ||
      message.includes("employees") ||
      message.includes("sites") ||
      message.includes("payroll"))
  );
}

export function getProjectDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): string {
  if (!error?.message) {
    return "Unable to delete this contract/project. Try again.";
  }

  const constraintName =
    extractForeignKeyConstraintName(error.message) ??
    Object.keys(PROJECT_DELETE_FK_MESSAGES).find((name) =>
      error.message.includes(name),
    );

  if (constraintName && PROJECT_DELETE_FK_MESSAGES[constraintName]) {
    return PROJECT_DELETE_FK_MESSAGES[constraintName];
  }

  if (isProjectDeleteForeignKeyError(error)) {
    return "This contract/project is linked to other records and can't be deleted. Deactivate it instead, or remove the linked records first.";
  }

  // Never surface raw Postgres / PostgREST constraint text to the user.
  if (
    /violates foreign key constraint/i.test(error.message) ||
    error.code === "23503"
  ) {
    return "This contract/project is linked to other records and can't be deleted. Deactivate it instead, or remove the linked records first.";
  }

  return "Unable to delete this contract/project. Try again.";
}
