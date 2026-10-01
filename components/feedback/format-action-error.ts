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

/**
 * Maps thrown values, RPC/Postgres errors, and network failures to user-facing text.
 */
export function formatActionError(error: unknown): string {
  if (error === null || error === undefined) {
    return "Something went wrong.";
  }

  if (typeof error === "string") {
    const trimmed = trimMessage(error);
    if (!trimmed) {
      return "Something went wrong.";
    }
    if (NETWORK_ERROR_PATTERN.test(trimmed)) {
      return "Couldn't reach the server — check your connection and try again.";
    }
    return trimmed;
  }

  if (error instanceof Error) {
    const trimmed = trimMessage(error.message);
    if (!trimmed) {
      return "Something went wrong.";
    }
    if (NETWORK_ERROR_PATTERN.test(trimmed)) {
      return "Couldn't reach the server — check your connection and try again.";
    }
    return trimmed;
  }

  if (typeof error === "object") {
    const fromPostgres = messageFromPostgresLike(error as PostgresLikeError);
    if (fromPostgres) {
      if (NETWORK_ERROR_PATTERN.test(fromPostgres)) {
        return "Couldn't reach the server — check your connection and try again.";
      }
      return fromPostgres;
    }
  }

  return "Something went wrong.";
}
