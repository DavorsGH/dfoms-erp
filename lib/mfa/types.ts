export type MfaMethod = "none" | "totp" | "sms";

export type MfaPersona = "staff" | "lessee" | "landlord";

export type MfaGateStatus = "not_required" | "pending" | "satisfied";

export type SmsOtpPurpose = "login" | "enrollment";

export type UserMfaSettingsRow = {
  auth_uid: string;
  method: MfaMethod;
  sms_phone_e164: string | null;
  sms_phone_verified_at: string | null;
  totp_enrolled_at: string | null;
  updated_at: string;
};

export type PostLoginMfaResult =
  | { mfaRequired: false }
  | {
      mfaRequired: true;
      method: "totp" | "sms";
      maskedPhone?: string;
    };

export type MfaActionResult =
  | { ok: true }
  | { ok: false; error: string; resendAvailableInSeconds?: number };

export type LoginWithMfaResult =
  | { ok: true; mfaRequired?: false }
  | {
      ok: true;
      mfaRequired: true;
      method: "totp" | "sms";
      maskedPhone?: string;
    }
  | { ok: false; error: string };

export type MfaChallengeRoute = {
  challengePath: string;
  loginPath: string;
  defaultNext: string;
};

export const MFA_CHALLENGE_ROUTES: Record<MfaPersona, MfaChallengeRoute> = {
  staff: {
    challengePath: "/login/mfa",
    loginPath: "/login",
    defaultNext: "/dashboard",
  },
  lessee: {
    challengePath: "/portal/login/mfa",
    loginPath: "/portal/login",
    defaultNext: "/portal/dashboard",
  },
  landlord: {
    challengePath: "/landlord-portal/login/mfa",
    loginPath: "/landlord-portal/login",
    defaultNext: "/landlord-portal/dashboard",
  },
};

export const MFA_PENDING_PUBLIC_PATHS = new Set([
  "/login/mfa",
  "/portal/login/mfa",
  "/landlord-portal/login/mfa",
]);
