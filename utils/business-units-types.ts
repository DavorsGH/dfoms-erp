export const BUSINESS_UNIT_SELECT =
  "id, tenant_id, name, logo_url, invoice_address, business_email, is_active, created_at, updated_at" as const;

export type BusinessUnitRow = {
  id: string;
  tenant_id: string;
  name: string;
  logo_url: string | null;
  invoice_address: string | null;
  business_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BusinessUnitInput = {
  name?: string;
  logo_url?: string | null;
  invoice_address?: string | null;
  business_email?: string | null;
  is_active?: boolean;
};

export type BusinessUnitUpdateBody = BusinessUnitInput & {
  id: string;
};

export type BusinessUnitDeactivateBody = {
  id: string;
};

export function emptyBusinessUnitForm() {
  return {
    name: "",
    invoice_address: "",
    business_email: "",
    is_active: true,
  };
}

export function businessUnitToForm(row: BusinessUnitRow) {
  return {
    name: row.name,
    invoice_address: row.invoice_address ?? "",
    business_email: row.business_email ?? "",
    is_active: row.is_active,
  };
}

export function trimBusinessUnitInput(input: BusinessUnitInput) {
  const logoUrl =
    input.logo_url === undefined
      ? undefined
      : input.logo_url === null
        ? null
        : input.logo_url.trim() || null;

  return {
    name: (input.name ?? "").trim(),
    invoice_address: (input.invoice_address ?? "").trim() || null,
    business_email: (input.business_email ?? "").trim() || null,
    is_active: input.is_active ?? true,
    ...(logoUrl !== undefined ? { logo_url: logoUrl } : {}),
  };
}

const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateBusinessUnitInput(input: BusinessUnitInput): string | null {
  const trimmed = trimBusinessUnitInput(input);

  if (!trimmed.name) {
    return "Business unit name is required.";
  }

  if (trimmed.business_email && !BASIC_EMAIL_RE.test(trimmed.business_email)) {
    return "Business email must be a valid email address.";
  }

  return null;
}
