/**
 * Shared document contact / branding fields for a stamped business unit.
 * Client-safe (no server-only imports).
 */
export type BusinessUnitDocumentContact = {
  id: string;
  name: string;
  logo_url: string | null;
  /** Signed (or public) URL for on-screen / client PDF logo; null when BU has no logo. */
  logoUrl: string | null;
  invoice_address: string | null;
  business_email: string | null;
};

/** Build contact from switcher option fields (create-form preview before save). */
export function businessUnitDocumentContactFromSwitcher(unit: {
  id: string;
  name: string;
  logo_url: string | null;
  logoUrl: string | null;
  invoice_address?: string | null;
  business_email?: string | null;
}): BusinessUnitDocumentContact {
  return {
    id: unit.id,
    name: unit.name?.trim() || "",
    logo_url: unit.logo_url?.trim() || null,
    logoUrl: unit.logoUrl?.trim() || null,
    invoice_address: unit.invoice_address?.trim() || null,
    business_email: unit.business_email?.trim() || null,
  };
}
