import type { PostgrestError } from "@supabase/supabase-js";

const FK_CONSTRAINT_NAME_PATTERN =
  /violates foreign key constraint "([^"]+)"/i;

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
