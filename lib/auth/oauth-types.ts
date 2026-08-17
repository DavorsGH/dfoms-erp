import type { PortalKind } from "@/lib/middleware-auth-context";

export type OAuthPersona = PortalKind;

export type OAuthFlow = "login" | "open_signup" | "accept_invite";

export type OAuthProvider = "google" | "azure";

export type OAuthSignupFields = {
  company_name?: string;
  admin_full_name?: string;
  admin_email?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
};

export type OAuthFlowPayload = {
  persona: OAuthPersona;
  flow: OAuthFlow;
  invite_token?: string;
  signup?: OAuthSignupFields;
  next?: string;
  issued_at: number;
};

export const OAUTH_FLOW_COOKIE = "dfoms-oauth-flow";

export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  azure: "Microsoft",
};

export function parseOAuthProvider(value: string | null | undefined): OAuthProvider | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "google") return "google";
  if (normalized === "azure" || normalized === "microsoft") return "azure";
  return null;
}

export function parseOAuthPersona(value: string | null | undefined): OAuthPersona | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "staff" || normalized === "lessee" || normalized === "landlord") {
    return normalized;
  }
  return null;
}

export function parseOAuthFlow(value: string | null | undefined): OAuthFlow | null {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "login" ||
    normalized === "open_signup" ||
    normalized === "accept_invite"
  ) {
    return normalized;
  }
  return null;
}

export function defaultDashboardForPersona(persona: OAuthPersona): string {
  switch (persona) {
    case "staff":
      return "/dashboard";
    case "lessee":
      return "/portal/dashboard";
    case "landlord":
      return "/landlord-portal/dashboard";
  }
}
