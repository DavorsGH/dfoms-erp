export type UserActivityPersona = "staff" | "lessee" | "landlord";

export type UserActivityStatus = "success" | "failure";

export type UserActivityEventName =
  | "login.password_success"
  | "login.password_failure"
  | "login.mfa_success"
  | "login.mfa_failure"
  | "login.oauth_success"
  | "login.oauth_failure"
  | "login.rate_limited";

export type UserActivityLogRow = {
  id: string;
  persona: UserActivityPersona;
  tenant_id: string | null;
  auth_user_id: string | null;
  email: string | null;
  event_name: UserActivityEventName | string;
  status: UserActivityStatus;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export const USER_ACTIVITY_LOG_PAGE_SIZE = 25;

export const USER_ACTIVITY_PERSONA_VALUES: readonly UserActivityPersona[] = [
  "staff",
  "lessee",
  "landlord",
];

export const USER_ACTIVITY_STATUS_VALUES: readonly UserActivityStatus[] = [
  "success",
  "failure",
];

export const USER_ACTIVITY_EVENT_NAME_VALUES: readonly UserActivityEventName[] =
  [
    "login.password_success",
    "login.password_failure",
    "login.mfa_success",
    "login.mfa_failure",
    "login.oauth_success",
    "login.oauth_failure",
    "login.rate_limited",
  ];

export function parseUserActivityPersonaFilter(
  value: string | undefined,
): UserActivityPersona | "" {
  if (value && USER_ACTIVITY_PERSONA_VALUES.includes(value as UserActivityPersona)) {
    return value as UserActivityPersona;
  }
  return "";
}

export function parseUserActivityStatusFilter(
  value: string | undefined,
): UserActivityStatus | "" {
  if (value && USER_ACTIVITY_STATUS_VALUES.includes(value as UserActivityStatus)) {
    return value as UserActivityStatus;
  }
  return "";
}

export function parseUserActivityPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function formatUserActivityEventLabel(eventName: string): string {
  return eventName.replace(/^login\./, "").replace(/_/g, " ");
}
