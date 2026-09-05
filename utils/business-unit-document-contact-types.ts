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

export type BusinessUnitSwitcherBrandingFields = {
  id: string;
  name: string;
  logo_url: string | null;
  logoUrl: string | null;
  invoice_address?: string | null;
  business_email?: string | null;
};

/** Build contact from switcher option fields (create-form preview before save). */
export function businessUnitDocumentContactFromSwitcher(
  unit: BusinessUnitSwitcherBrandingFields,
): BusinessUnitDocumentContact {
  return {
    id: unit.id,
    name: unit.name?.trim() || "",
    logo_url: unit.logo_url?.trim() || null,
    logoUrl: unit.logoUrl?.trim() || null,
    invoice_address: unit.invoice_address?.trim() || null,
    business_email: unit.business_email?.trim() || null,
  };
}

/**
 * Resolve stamped BU contact from already-loaded switcher units (signed logos).
 * Returns null when businessUnitId is null/default or the unit is not in the list.
 */
export function resolveBusinessUnitDocumentContactFromUnits(
  units: BusinessUnitSwitcherBrandingFields[],
  businessUnitId: string | null | undefined,
): BusinessUnitDocumentContact | null {
  const id = businessUnitId?.trim() || null;
  if (!id) {
    return null;
  }

  const unit = units.find((entry) => entry.id === id);
  if (!unit) {
    return null;
  }

  return businessUnitDocumentContactFromSwitcher(unit);
}

/**
 * When every id is the same non-null UUID, return that id.
 * Null/default ids or mixed BUs → null (caller keeps tenant branding).
 */
export function resolveUniformBusinessUnitId(
  businessUnitIds: Array<string | null | undefined>,
): string | null {
  if (businessUnitIds.length === 0) {
    return null;
  }

  const normalized = businessUnitIds.map((id) => id?.trim() || null);
  const first = normalized[0];
  if (!first) {
    return null;
  }

  return normalized.every((id) => id === first) ? first : null;
}
