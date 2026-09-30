export const BUSINESS_UNIT_SELECT =
  "id, tenant_id, name, logo_url, invoice_address, business_email, phone, phone_alt, website, business_registration_number, gra_tin, is_active, is_primary, created_at, updated_at" as const;

export type BusinessUnitRow = {
  id: string;
  tenant_id: string;
  name: string;
  logo_url: string | null;
  invoice_address: string | null;
  business_email: string | null;
  phone: string | null;
  phone_alt: string | null;
  website: string | null;
  business_registration_number: string | null;
  gra_tin: string | null;
  is_active: boolean;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

export type BusinessUnitInput = {
  name?: string;
  logo_url?: string | null;
  invoice_address?: string | null;
  business_email?: string | null;
  phone?: string | null;
  phone_alt?: string | null;
  website?: string | null;
  business_registration_number?: string | null;
  gra_tin?: string | null;
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
    phone: "",
    phone_alt: "",
    website: "",
    business_registration_number: "",
    gra_tin: "",
    is_active: true,
  };
}

export function businessUnitToForm(row: BusinessUnitRow) {
  return {
    name: row.name,
    invoice_address: row.invoice_address ?? "",
    business_email: row.business_email ?? "",
    phone: row.phone ?? "",
    phone_alt: row.phone_alt ?? "",
    website: row.website ?? "",
    business_registration_number: row.business_registration_number ?? "",
    gra_tin: row.gra_tin ?? "",
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
    phone: (input.phone ?? "").trim() || null,
    phone_alt: (input.phone_alt ?? "").trim() || null,
    website: (input.website ?? "").trim() || null,
    business_registration_number:
      (input.business_registration_number ?? "").trim() || null,
    gra_tin: (input.gra_tin ?? "").trim() || null,
    is_active: input.is_active ?? true,
    ...(logoUrl !== undefined ? { logo_url: logoUrl } : {}),
  };
}

const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_LIKE_RE = /^[\d+\s().-]{6,32}$/;

function normalizeWebsiteForValidation(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function isValidWebsite(value: string): boolean {
  const normalized = normalizeWebsiteForValidation(value);
  try {
    const url = new URL(normalized);
    return Boolean(url.hostname.includes("."));
  } catch {
    return false;
  }
}

export function validateBusinessUnitInput(input: BusinessUnitInput): string | null {
  const trimmed = trimBusinessUnitInput(input);

  if (!trimmed.name) {
    return "Business unit name is required.";
  }

  if (trimmed.business_email && !BASIC_EMAIL_RE.test(trimmed.business_email)) {
    return "Business email must be a valid email address.";
  }

  if (trimmed.phone && !PHONE_LIKE_RE.test(trimmed.phone)) {
    return "Business phone must be a valid phone number.";
  }

  if (trimmed.phone_alt && !PHONE_LIKE_RE.test(trimmed.phone_alt)) {
    return "Alternative phone must be a valid phone number.";
  }

  if (trimmed.website && !isValidWebsite(trimmed.website)) {
    return "Website must be a valid web address.";
  }

  return null;
}
