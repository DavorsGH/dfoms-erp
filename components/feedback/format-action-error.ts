import {
  isPostgresForeignKeyViolation,
  looksLikeRawPostgresForeignKeyError,
  tryFormatRawForeignKeyDeleteMessage,
} from "@/utils/postgres-fk-violation";

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed/i;

type PostgresLikeError = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

function trimMessage(value: string): string {
  return value.trim();
}

function messageFromPostgresLike(error: PostgresLikeError): string | null {
  const parts: string[] = [];
  if (typeof error.message === "string" && error.message.trim()) {
    parts.push(error.message.trim());
  }
  if (typeof error.details === "string" && error.details.trim()) {
    parts.push(error.details.trim());
  }
  if (typeof error.hint === "string" && error.hint.trim()) {
    parts.push(error.hint.trim());
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" ");
}

function friendlyIfForeignKey(
  message: string,
  itemName?: string | null,
): string {
  const friendly = tryFormatRawForeignKeyDeleteMessage(message, {
    itemName: itemName ?? "This item",
  });
  if (friendly) {
    return friendly;
  }
  return message;
}

/**
 * Maps thrown values, RPC/Postgres errors, and network failures to user-facing text.
 * Postgres FK violations (23503 / raw constraint text) never surface as raw SQL.
 */
export function formatActionError(
  error: unknown,
  options?: { itemName?: string | null },
): string {
  if (error === null || error === undefined) {
    return "Something went wrong.";
  }

  if (typeof error === "string") {
    const trimmed = trimMessage(error);
    if (!trimmed) {
      return "Something went wrong.";
    }
    if (NETWORK_ERROR_PATTERN.test(trimmed)) {
      return "Couldn't reach the server. Check your connection and try again.";
    }
    return friendlyIfForeignKey(trimmed, options?.itemName);
  }

  if (error instanceof Error) {
    const trimmed = trimMessage(error.message);
    if (!trimmed) {
      return "Something went wrong.";
    }
    if (NETWORK_ERROR_PATTERN.test(trimmed)) {
      return "Couldn't reach the server. Check your connection and try again.";
    }
    return friendlyIfForeignKey(trimmed, options?.itemName);
  }

  if (typeof error === "object") {
    const pg = error as PostgresLikeError;
    const pgLike = {
      code: pg.code ?? "",
      message: pg.message ?? "",
    };
    if (
      isPostgresForeignKeyViolation(pgLike) ||
      looksLikeRawPostgresForeignKeyError(pg.message)
    ) {
      return (
        tryFormatRawForeignKeyDeleteMessage(pg.message, {
          itemName: options?.itemName ?? "This item",
        }) ?? "This item is linked to other records and can't be deleted."
      );
    }

    const fromPostgres = messageFromPostgresLike(pg);
    if (fromPostgres) {
      if (NETWORK_ERROR_PATTERN.test(fromPostgres)) {
        return "Couldn't reach the server. Check your connection and try again.";
      }
      return friendlyIfForeignKey(fromPostgres, options?.itemName);
    }
  }

  return "Something went wrong.";
}
