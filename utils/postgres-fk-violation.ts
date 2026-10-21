import type { PostgrestError } from "@supabase/supabase-js";

const FK_CONSTRAINT_NAME_PATTERN =
  /violates foreign key constraint "([^"]+)"/i;

/** Referencing (child) table — the one after the constraint name, not the deleted parent. */
const FK_REFERENCING_TABLE_PATTERN =
  /violates foreign key constraint "[^"]+" on table "([^"]+)"/i;

/** Common referencing tables → plain English for delete errors. */
const FK_REFERENCING_TABLE_LABELS: Record<string, string> = {
  salary_advance_register: "salary advances",
  client_invoice_payment_accounts: "invoices",
  client_quotation_payment_accounts: "quotations",
  product_purchases: "purchases",
  employees: "employees",
  income_register: "income records",
  expense_register: "expense records",
  sites: "sites",
  work_orders: "work orders",
  crm_sales: "sales",
  suppliers: "suppliers",
  finished_products: "products",
  payment_accounts: "payment accounts",
};

const UNIQUE_CONSTRAINT_NAME_PATTERN =
  /violates unique constraint "([^"]+)"/i;

export function extractPostgresForeignKeyConstraintName(
  message: string | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const match = message.match(FK_CONSTRAINT_NAME_PATTERN);
  return match?.[1] ?? null;
}

export function extractPostgresUniqueConstraintName(
  message: string | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const match = message.match(UNIQUE_CONSTRAINT_NAME_PATTERN);
  return match?.[1] ?? null;
}

export function isPostgresUniqueViolation(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) {
    return false;
  }

  if (error.code === "23505") {
    return true;
  }

  return (error.message ?? "")
    .toLowerCase()
    .includes("violates unique constraint");
}

export function isPostgresForeignKeyViolation(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) {
    return false;
  }

  if (error.code === "23503") {
    return true;
  }

  return (error.message ?? "")
    .toLowerCase()
    .includes("violates foreign key constraint");
}

export type PostgresForeignKeyDeleteErrorOptions = {
  constraintMessages?: Record<string, string>;
  fallbackInUseMessage: string;
  fallbackGenericMessage?: string;
};

export function getPostgresForeignKeyDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
  options: PostgresForeignKeyDeleteErrorOptions,
): string | null {
  if (!isPostgresForeignKeyViolation(error)) {
    return null;
  }

  const constraintName =
    extractPostgresForeignKeyConstraintName(error?.message) ??
    Object.keys(options.constraintMessages ?? {}).find((name) =>
      (error?.message ?? "").includes(name),
    );

  if (constraintName && options.constraintMessages?.[constraintName]) {
    return options.constraintMessages[constraintName];
  }

  return options.fallbackInUseMessage;
}

export type PostgresRpcErrorMessageOptions = {
  constraintMessages?: Record<string, string>;
  fallbackMessage: string;
};

export function resolvePostgresRpcErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
  options: PostgresRpcErrorMessageOptions,
): string | null {
  if (!error?.message) {
    return null;
  }

  const message = error.message;

  if (isPostgresUniqueViolation(error)) {
    const uniqueName =
      extractPostgresUniqueConstraintName(message) ??
      Object.keys(options.constraintMessages ?? {}).find((name) =>
        message.includes(name),
      );
    if (uniqueName && options.constraintMessages?.[uniqueName]) {
      return options.constraintMessages[uniqueName];
    }
  }

  if (isPostgresForeignKeyViolation(error)) {
    const fkName =
      extractPostgresForeignKeyConstraintName(message) ??
      Object.keys(options.constraintMessages ?? {}).find((name) =>
        message.includes(name),
      );
    if (fkName && options.constraintMessages?.[fkName]) {
      return options.constraintMessages[fkName];
    }
  }

  if (
    isPostgresUniqueViolation(error) ||
    isPostgresForeignKeyViolation(error)
  ) {
    return options.fallbackMessage;
  }

  return null;
}

export function resolveDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
  options: PostgresForeignKeyDeleteErrorOptions & {
    fallbackNonFkMessage?: string;
  },
): string {
  const fkMessage = getPostgresForeignKeyDeleteErrorMessage(error, options);
  if (fkMessage) {
    return fkMessage;
  }

  if (error?.message && isPostgresForeignKeyViolation(error)) {
    return options.fallbackInUseMessage;
  }

  return (
    options.fallbackNonFkMessage ??
    options.fallbackGenericMessage ??
    "Unable to complete this delete. Try again."
  );
}

export function looksLikeRawPostgresForeignKeyError(
  message: string | null | undefined,
): boolean {
  if (!message?.trim()) {
    return false;
  }
  const lower = message.toLowerCase();
  return (
    lower.includes("violates foreign key constraint") ||
    lower.startsWith("update or delete on table") ||
    lower.includes("violates foreign key")
  );
}

export function extractPostgresForeignKeyReferencingTable(
  message: string | null | undefined,
): string | null {
  if (!message) {
    return null;
  }
  const match = message.match(FK_REFERENCING_TABLE_PATTERN);
  return match?.[1] ?? null;
}

export function humanizeForeignKeyReferencingTable(
  tableOrConstraint: string | null | undefined,
): string {
  const raw = tableOrConstraint?.trim() ?? "";
  if (!raw) {
    return "other records";
  }
  if (FK_REFERENCING_TABLE_LABELS[raw]) {
    return FK_REFERENCING_TABLE_LABELS[raw];
  }
  // Constraint names often end with _fkey and include the child table.
  const withoutFkey = raw.replace(/_fkey$/i, "");
  if (FK_REFERENCING_TABLE_LABELS[withoutFkey]) {
    return FK_REFERENCING_TABLE_LABELS[withoutFkey];
  }
  const tableGuess = withoutFkey.split("_payment_account")[0] ?? withoutFkey;
  if (FK_REFERENCING_TABLE_LABELS[tableGuess]) {
    return FK_REFERENCING_TABLE_LABELS[tableGuess];
  }
  return raw.replace(/_/g, " ");
}

/**
 * Plain-language delete-blocked message for Postgres 23503 / raw FK text.
 * Never returns the raw constraint name.
 */
export function formatFriendlyForeignKeyDeleteMessage(
  message: string | null | undefined,
  options?: {
    itemName?: string | null;
    linkedLabel?: string | null;
    canDeactivateHint?: boolean;
  },
): string {
  const item = options?.itemName?.trim() || "This item";
  const constraint = extractPostgresForeignKeyConstraintName(message);
  const onTable = extractPostgresForeignKeyReferencingTable(message);
  const linked =
    options?.linkedLabel?.trim() ||
    humanizeForeignKeyReferencingTable(onTable ?? constraint);
  const deactivateHint =
    options?.canDeactivateHint === false
      ? ""
      : " Remove or reassign those records first, or deactivate it if available.";
  return `${item} is linked to ${linked} and can't be deleted.${deactivateHint}`;
}

/**
 * If `message` is a raw FK violation, return a friendly string; otherwise null.
 */
export function tryFormatRawForeignKeyDeleteMessage(
  message: string | null | undefined,
  options?: {
    itemName?: string | null;
    linkedLabel?: string | null;
    canDeactivateHint?: boolean;
  },
): string | null {
  if (!looksLikeRawPostgresForeignKeyError(message)) {
    return null;
  }
  return formatFriendlyForeignKeyDeleteMessage(message, options);
}

/**
 * API helper: map a Postgrest delete error to a user-facing message.
 * FK violations never return raw constraint text.
 */
export function resolveApiDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
  options: {
    itemName: string;
    fallbackMessage?: string;
  },
): string {
  if (!error) {
    return options.fallbackMessage ?? `Unable to delete ${options.itemName}. Try again.`;
  }

  if (isPostgresForeignKeyViolation(error)) {
    return (
      tryFormatRawForeignKeyDeleteMessage(error.message, {
        itemName: options.itemName,
      }) ??
      `${options.itemName} is linked to other records and can't be deleted.`
    );
  }

  const trimmed = error.message?.trim();
  if (trimmed && !looksLikeRawPostgresForeignKeyError(trimmed)) {
    return trimmed;
  }

  return options.fallbackMessage ?? `Unable to delete ${options.itemName}. Try again.`;
}
