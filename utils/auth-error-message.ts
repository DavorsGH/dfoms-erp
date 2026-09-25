import { mapSupabasePasswordError } from "@/utils/password-policy";

export const FORGOT_PASSWORD_NEUTRAL_SUCCESS_MESSAGE =
  "If an account exists for this email, we've sent a password reset link.";

const EMAIL_RATE_LIMIT_MESSAGE =
  "Please wait a minute before requesting another reset link. If you already received an email, you can use the link in it.";

const NETWORK_MESSAGE =
  "We couldn't reach the server. Check your connection and try again.";

const GENERIC_MESSAGE =
  "Something went wrong. Please try again in a moment.";

export type AuthErrorMessageContext = "general" | "forgot-password" | "reset-password";

type AuthErrorShape = {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
};

function extractShape(error: unknown): AuthErrorShape {
  if (error == null) return {};
  if (typeof error === "string") return { message: error };
  if (error instanceof Error) {
    const extended = error as Error & { code?: string; status?: number };
    return {
      message: extended.message,
      code: extended.code,
      status: extended.status,
      name: extended.name,
    };
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const status =
      typeof record.status === "number"
        ? record.status
        : typeof record.statusCode === "number"
          ? record.statusCode
          : undefined;
    return {
      message: typeof record.message === "string" ? record.message : undefined,
      code: typeof record.code === "string" ? record.code : undefined,
      status,
      name: typeof record.name === "string" ? record.name : undefined,
    };
  }
  return {};
}

function isUnreadableMessage(message: string | undefined): boolean {
  if (!message) return true;
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (trimmed === "{}" || trimmed === "[]") return true;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function isReadableUserMessage(message: string): boolean {
  if (isUnreadableMessage(message)) return false;
  return /[a-zA-Z]/.test(message);
}

export function isEmailSendRateLimitError(error: unknown): boolean {
  const shape = extractShape(error);
  if (shape.status === 429) return true;
  if (shape.code === "over_email_send_rate_limit") return true;
  const lower = (shape.message ?? "").toLowerCase();
  if (lower.includes("security purposes")) return true;
  if (lower.includes("rate limit")) return true;
  if (lower.includes("email rate limit")) return true;
  return false;
}

function isNetworkAuthError(error: unknown, shape: AuthErrorShape): boolean {
  const name = (shape.name ?? "").toLowerCase();
  if (name.includes("networkerror")) return true;
  if (name.includes("authretryablefetcherror")) {
    return !isEmailSendRateLimitError(error);
  }
  const lower = (shape.message ?? "").toLowerCase();
  if (lower.includes("failed to fetch")) return true;
  if (lower.includes("network error")) return true;
  if (lower.includes("fetch failed")) return true;
  return false;
}

function isForgotPasswordUserNotFoundError(shape: AuthErrorShape): boolean {
  const code = (shape.code ?? "").toLowerCase();
  if (code === "user_not_found") return true;
  const lower = (shape.message ?? "").toLowerCase();
  if (lower.includes("user not found")) return true;
  if (lower.includes("user does not exist")) return true;
  return false;
}

function shouldUsePasswordErrorMapper(
  shape: AuthErrorShape,
  context: AuthErrorMessageContext,
): boolean {
  if (context !== "reset-password") return false;
  const code = (shape.code ?? "").toLowerCase();
  if (code.includes("password")) return true;
  const lower = (shape.message ?? "").toLowerCase();
  if (lower.includes("password")) return true;
  return false;
}

/**
 * Turn Supabase Auth errors, fetch failures, API payloads, or unknown values
 * into a safe user-facing string — never JSON or "[object Object]".
 */
export function formatAuthErrorMessage(
  error: unknown,
  options?: { context?: AuthErrorMessageContext },
): string {
  const context = options?.context ?? "general";
  const shape = extractShape(error);

  if (isEmailSendRateLimitError(error)) {
    return EMAIL_RATE_LIMIT_MESSAGE;
  }

  if (
    context === "forgot-password" &&
    shape.name === "AuthRetryableFetchError" &&
    isUnreadableMessage(shape.message)
  ) {
    return EMAIL_RATE_LIMIT_MESSAGE;
  }

  if (isNetworkAuthError(error, shape)) {
    return NETWORK_MESSAGE;
  }

  if (
    shouldUsePasswordErrorMapper(shape, context) &&
    typeof error === "object" &&
    error !== null
  ) {
    return mapSupabasePasswordError(
      error as { message?: string; code?: string },
    );
  }

  if (shape.message && isReadableUserMessage(shape.message)) {
    return shape.message.trim();
  }

  return GENERIC_MESSAGE;
}

/** Forgot-password: show neutral success instead of revealing unknown emails. */
export function shouldTreatForgotPasswordAsSuccess(error: unknown): boolean {
  if (error == null) return true;
  if (isEmailSendRateLimitError(error)) return false;
  if (isForgotPasswordUserNotFoundError(extractShape(error))) return true;
  return false;
}
