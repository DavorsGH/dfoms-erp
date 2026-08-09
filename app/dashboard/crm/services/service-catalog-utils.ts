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
