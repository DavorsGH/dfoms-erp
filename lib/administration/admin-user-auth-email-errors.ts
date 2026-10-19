/** User-facing copy for Administration → User Accounts email / auth failures. */

export const ADMIN_USER_EMAIL_ALREADY_REGISTERED =
  "This email is already used by another login on the platform. Use a different email or contact support.";

export const ADMIN_USER_INVALID_EMAIL =
  "Please enter a valid email address.";

export const ADMIN_USER_UPDATE_FAILED =
  "Could not update user. Please try again.";

export const ADMIN_USER_CREATE_FAILED =
  "Could not create user. Please try again.";

function isEmailAlreadyRegisteredMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("already been registered") ||
    lower.includes("already registered") ||
    lower.includes("user already registered") ||
    lower.includes("email address has already been") ||
    lower.includes("email already exists") ||
    lower.includes("duplicate") && lower.includes("email") ||
    lower.includes("users_email_partial_key") ||
    lower.includes("unique") && lower.includes("email")
  );
}

function isInvalidEmailMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid email") ||
    lower.includes("unable to validate email") ||
    lower.includes("email format") ||
    lower.includes("malformed email") ||
    lower.includes("is invalid")
  );
}

/**
 * Map Supabase Auth admin email errors to safe user-facing messages.
 * Logs the raw message when returning a generic fallback.
 */
export function mapSupabaseAuthEmailError(
  error: { message?: string } | null | undefined,
  context: "update" | "create",
): string {
  const raw = error?.message?.trim() ?? "";
  const fallback =
    context === "update"
      ? ADMIN_USER_UPDATE_FAILED
      : ADMIN_USER_CREATE_FAILED;

  if (!raw) {
    return fallback;
  }

  if (isEmailAlreadyRegisteredMessage(raw)) {
    return ADMIN_USER_EMAIL_ALREADY_REGISTERED;
  }

  if (isInvalidEmailMessage(raw)) {
    return ADMIN_USER_INVALID_EMAIL;
  }

  console.error(`[admin/users/${context}] auth email error:`, raw);
  return fallback;
}

/** Prefer email mapping; fall back to password policy mapping for createUser. */
export function mapSupabaseCreateUserError(
  error: { message?: string; code?: string } | null | undefined,
  mapPasswordError: (error: unknown) => string,
): string {
  const raw = error?.message?.trim() ?? "";
  if (raw) {
    if (isEmailAlreadyRegisteredMessage(raw)) {
      return ADMIN_USER_EMAIL_ALREADY_REGISTERED;
    }
    if (isInvalidEmailMessage(raw)) {
      return ADMIN_USER_INVALID_EMAIL;
    }
  }

  const passwordMapped = mapPasswordError(error);
  const genericPasswordFallback = "Could not update password. Please try again.";
  if (passwordMapped !== genericPasswordFallback) {
    return passwordMapped;
  }

  if (raw) {
    console.error("[admin/users/create] auth.admin.createUser:", raw);
  }
  return ADMIN_USER_CREATE_FAILED;
}
