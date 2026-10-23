export type PortalLoginTargetPersona =
  | "landlord"
  | "lessee"
  | "facility_manager"
  | "staff";

export type PortalLoginActorPersona =
  | "davors_admin"
  | "landlord"
  | "tenant_admin";

export type PortalLoginAccessAction =
  | "reset_link_sent"
  | "temp_password_set"
  | "email_changed"
  | "login_created";

export type PortalLoginVerificationMethod =
  | "called_back_on_number_on_file"
  | "security_questions"
  | "in_person"
  | "other";

export const PORTAL_LOGIN_VERIFICATION_OPTIONS: Array<{
  value: PortalLoginVerificationMethod;
  label: string;
}> = [
  {
    value: "called_back_on_number_on_file",
    label: "Called back on number on file",
  },
  { value: "security_questions", label: "Security questions" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
];

export type PortalLoginTargetRef =
  | { persona: "landlord"; tenantId: string }
  | { persona: "lessee"; tenantId: string; lesseeId: string }
  | {
      persona: "facility_manager";
      tenantId: string;
      facilityManagerId: string;
    }
  | { persona: "staff"; tenantId: string; authUid: string };

export type ResolvedPortalLoginTarget = {
  persona: PortalLoginTargetPersona;
  tenantId: string;
  recordId: string;
  displayName: string;
  profileEmail: string | null;
  authUserId: string | null;
  landlordType: "platform_only" | "davors_managed" | null;
};

export type SharedLoginLink = {
  kind: "staff" | "landlord" | "lessee" | "facility_manager";
  tenantId: string | null;
  recordId: string;
  label: string;
};

export type PortalLoginAuthStatus = {
  authUserExists: boolean;
  authUserId: string | null;
  loginEmail: string | null;
  lastSignInAt: string | null;
  isSuspended: boolean;
  sharedLinks: SharedLoginLink[];
  profileEmail: string | null;
  displayName: string;
  landlordType: "platform_only" | "davors_managed" | null;
};

export const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

export const SHARED_LOGIN_LANDLORD_REFUSAL_MESSAGE =
  "This login is also used for another account on the platform. Please contact Davors support to reset it.";

/** Same refusal copy for landlord and tenant-admin (non-Davors) actors. */
export const SHARED_LOGIN_NON_DAVORS_REFUSAL_MESSAGE =
  SHARED_LOGIN_LANDLORD_REFUSAL_MESSAGE;

export const TEMP_PASSWORD_EXPIRED_MESSAGE =
  "Your temporary password has expired. Please contact your administrator or Davors support.";
