/** Modern password policy: length + breached-password check (via Supabase Auth). */
export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_POLICY_HINT =
  "Use at least 12 characters. Avoid passwords known from data breaches.";

export type WeakPasswordReason = "length" | "characters" | "pwned";

export function validatePasswordLength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

export function validatePasswordMatch(
  password: string,
  confirmPassword: string,
): string | null {
  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}

export function validatePasswordClient(
  password: string,
  confirmPassword: string,
): string | null {
  return (
    validatePasswordLength(password) ?? validatePasswordMatch(password, confirmPassword)
  );
}

type PasswordErrorLike = {
  code?: string;
  message?: string;
  reasons?: WeakPasswordReason[];
};

/** Map Supabase weak_password / AuthWeakPasswordError to user-friendly copy. */
export function mapSupabasePasswordError(error: unknown): string {
  if (!error) {
    return "Could not update password. Please try again.";
  }

  const e: PasswordErrorLike =
    typeof error === "object" && error !== null
      ? (error as PasswordErrorLike)
      : { message: String(error) };

  const reasons = Array.isArray(e.reasons) ? e.reasons : [];
  const isWeak =
    e.code === "weak_password" ||
    reasons.length > 0 ||
    /weak.?password/i.test(e.message ?? "");

  if (isWeak) {
    if (reasons.includes("pwned")) {
      return "This password has appeared in a known data breach. Choose a different password.";
    }
    if (reasons.includes("length")) {
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (reasons.includes("characters")) {
      return "Password does not meet the required character rules.";
    }
    const msg = e.message?.trim();
    if (msg) {
      const lower = msg.toLowerCase();
      if (
        lower.includes("pwned") ||
        lower.includes("data breach") ||
        lower.includes("easy to guess")
      ) {
        return "This password has appeared in a known data breach. Choose a different password.";
      }
      return msg;
    }
    return PASSWORD_POLICY_HINT;
  }

  if (e.code === "same_password") {
    return "Choose a different password than your current one.";
  }

  return e.message?.trim() || "Could not update password. Please try again.";
}

/** Policy rollout cutoff — users with password_updated_at before this get a nudge. */
export function getPasswordPolicyRolloutDate(): Date {
  const raw =
    process.env.PASSWORD_POLICY_ROLLOUT_AT?.trim() || "2026-08-07T00:00:00.000Z";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return new Date("2026-08-07T00:00:00.000Z");
  }
  return parsed;
}
