import type { PostgrestError } from "@supabase/supabase-js";

const FK_CONSTRAINT_NAME_PATTERN =
  /violates foreign key constraint "([^"]+)"/i;

export function extractPostgresForeignKeyConstraintName(
  message: string | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const match = message.match(FK_CONSTRAINT_NAME_PATTERN);
  return match?.[1] ?? null;
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
