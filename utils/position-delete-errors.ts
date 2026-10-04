import type { PostgrestError } from "@supabase/supabase-js";

import { formatEmployeesStillUseItClause } from "@/utils/delete-blocked-messaging";

import {

  isPostgresForeignKeyViolation,

  resolveDeleteErrorMessage,

  type PostgresForeignKeyDeleteErrorOptions,

} from "@/utils/postgres-fk-violation";



export function formatPositionDeleteBlockedMessage(

  positionTitle: string,

  employeeCount: number,

): string {

  return `${positionTitle} can't be deleted because ${formatEmployeesStillUseItClause(employeeCount)}. Reassign them to another position first.`;

}



export function formatPositionDeleteStillInUseMessage(

  positionTitle: string,

): string {

  return `${positionTitle} can't be deleted because it's still in use.`;

}



export function formatPositionDeleteFailedMessage(

  positionTitle: string,

): string {

  return `Couldn't delete ${positionTitle}. Please try again.`;

}



export function formatPositionDuplicateTitleMessage(

  positionTitle: string,

): string {

  return `${positionTitle} already exists.`;

}



export function formatPositionAddFailedMessage(positionTitle: string): string {

  return `Couldn't add ${positionTitle}. Please try again.`;

}



const POSITION_DELETE_FK_OPTIONS: PostgresForeignKeyDeleteErrorOptions = {

  constraintMessages: {

    employees_position_fkey:

      "This position is still assigned to employees and can't be deleted. Reassign them to another position first.",

    employee_employment_history_position_fkey:

      "This position appears in employment history and can't be deleted.",

    pay_rate_structure_position_fkey:

      "This position is used in pay rate settings and can't be deleted.",

    compensation_policy_position_fkey:

      "This position is used in salary allowance settings and can't be deleted.",

    leave_entitlement_policy_position_fkey:

      "This position is used in leave entitlement settings and can't be deleted.",

    salary_rate_config_position_fkey:

      "This position is used in salary rate settings and can't be deleted.",

  },

  fallbackInUseMessage:

    "This position is linked to other records and can't be deleted. Reassign or remove those links first.",

};



export function getPositionDeleteErrorMessage(

  error: Pick<PostgrestError, "code" | "message"> | null | undefined,

  positionTitle?: string,

): string {

  const title = positionTitle?.trim();

  const fkMessage = resolveDeleteErrorMessage(error, {

    ...POSITION_DELETE_FK_OPTIONS,

    fallbackNonFkMessage: title

      ? formatPositionDeleteFailedMessage(title)

      : "Unable to delete this position. Try again.",

  });



  if (title && isPostgresForeignKeyViolation(error)) {

    return formatPositionDeleteStillInUseMessage(title);

  }



  return fkMessage;

}



export function resolvePositionDeleteApiErrorMessage(

  positionTitle: string,

  error: Pick<PostgrestError, "code" | "message"> | null | undefined,

): string {

  if (isPostgresForeignKeyViolation(error)) {

    return formatPositionDeleteStillInUseMessage(positionTitle);

  }



  return getPositionDeleteErrorMessage(error, positionTitle);

}



export function resolvePositionDeleteClientMessage(

  positionTitle: string,

  apiError: string | undefined,

  postgresLike?: Pick<PostgrestError, "code" | "message"> | null,

): string {

  const trimmed = apiError?.trim();

  if (trimmed && !looksLikeRawPostgresError(trimmed)) {

    return trimmed;

  }



  if (postgresLike) {

    return resolvePositionDeleteApiErrorMessage(positionTitle, postgresLike);

  }



  if (trimmed && isPostgresForeignKeyViolation({ message: trimmed, code: "23503" })) {

    return formatPositionDeleteStillInUseMessage(positionTitle);

  }



  return formatPositionDeleteFailedMessage(positionTitle);

}



function looksLikeRawPostgresError(message: string): boolean {

  const lower = message.toLowerCase();

  return (

    lower.includes("violates foreign key constraint") ||

    lower.includes("duplicate key value") ||

    lower.startsWith("update or delete on table")

  );

}



export function getLookupDeleteInUseMessage(label: string): string {

  return `${label} is still in use and can't be deleted. Remove or reassign linked records first.`;

}

