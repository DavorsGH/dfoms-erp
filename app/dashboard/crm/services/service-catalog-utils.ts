export type ServiceCatalogEntry = {
  id: string;
  service_name: string;
  description: string | null;
  default_rate: number | null;
  billing_unit: string | null;
  category: string | null;
};

export const SERVICE_CATALOG_SELECT =
  "id, service_name, description, default_rate, billing_unit, category";

export function normalizeServiceCatalogEntry(raw: {
  id: string;
  service_name: string;
  description?: string | null;
  default_rate?: number | string | null;
  billing_unit?: string | null;
  category?: string | null;
}): ServiceCatalogEntry {
  const parsedRate =
    raw.default_rate == null || raw.default_rate === ""
      ? null
      : Number(raw.default_rate);

  return {
    id: raw.id,
    service_name: raw.service_name,
    description: raw.description ?? null,
    default_rate: Number.isFinite(parsedRate) ? parsedRate : null,
    billing_unit: raw.billing_unit ?? null,
    category: raw.category ?? null,
  };
}

export function formatServiceCatalogRate(value: number | null): string {
  if (value == null) {
    return "—";
  }

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type ServiceCatalogFormState = {
  service_name: string;
  description: string;
  default_rate: string;
  billing_unit: string;
  category: string;
};

export const EMPTY_SERVICE_CATALOG_FORM: ServiceCatalogFormState = {
  service_name: "",
  description: "",
  default_rate: "",
  billing_unit: "",
  category: "",
};

export function serviceCatalogEntryToForm(
  entry: ServiceCatalogEntry,
): ServiceCatalogFormState {
  return {
    service_name: entry.service_name,
    description: entry.description ?? "",
    default_rate:
      entry.default_rate == null ? "" : String(entry.default_rate),
    billing_unit: entry.billing_unit ?? "",
    category: entry.category ?? "",
  };
}

export function buildServiceCatalogSavePayload(form: ServiceCatalogFormState): {
  service_name: string;
  description: string | null;
  default_rate: number | null;
  billing_unit: string | null;
  category: string | null;
} {
  const trimmedName = form.service_name.trim();
  const trimmedRate = form.default_rate.trim();
  const parsedRate = trimmedRate === "" ? null : Number(trimmedRate);

  return {
    service_name: trimmedName,
    description: form.description.trim() || null,
    default_rate:
      parsedRate == null || !Number.isFinite(parsedRate) ? null : parsedRate,
    billing_unit: form.billing_unit.trim() || null,
    category: form.category.trim() || null,
  };
}
