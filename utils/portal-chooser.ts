/** Public portal chooser (Business ERP / Landlord / Tenant). */
export const PORTAL_CHOOSER_PATH = "/";

export const PORTAL_CHOOSER_LABEL = {
  landlord: "Not a landlord? Choose your portal",
  tenant: "Not a tenant? Choose your portal",
  staff: "Not staff? Choose your portal",
} as const;

/**
 * Shown after Auth succeeds but the account is not linked to this portal.
 * Safe: only used when credentials were valid (no email-existence leak on bad password).
 */
export const WRONG_PORTAL_LOGIN_MESSAGE =
  "This account belongs to a different portal. Choose the correct portal to continue.";
