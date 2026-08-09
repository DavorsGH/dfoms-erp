import { FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE } from "@/lib/bulk-import/target-fields";

const DEFAULT_SOURCING_TYPE = "manufactured" as const;

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  return String(value).trim() === "";
}

function nullableText(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  return String(value).trim();
}

function parseOptionalNumber(value: unknown): number | null {
  if (isBlank(value)) {
    return null;
  }

  const parsed = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalDate(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

export type FinishedProductCommitInsert = {
  tenant_id: string;
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  current_stock: number;
  standard_selling_price: number | null;
  sourcing_type: typeof DEFAULT_SOURCING_TYPE | typeof FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE;
  supplier_id: string | null;
  manufacturing_date: string | null;
  expiration_date: string | null;
};

export type ServiceCatalogCommitInsert = {
  tenant_id: string;
  service_name: string;
  description: string | null;
  default_rate: number | null;
  billing_unit: string | null;
  category: string | null;
};

export function buildFinishedProductCommitInsert(
  mappedData: Record<string, unknown>,
  tenantId: string,
  resolvedSupplierId: string | null,
): FinishedProductCommitInsert {
  const sourcingRaw = String(mappedData.sourcing_type ?? "").trim().toLowerCase();
  const sourcing_type =
    sourcingRaw === FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE
      ? FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE
      : DEFAULT_SOURCING_TYPE;

  const supplier_id =
    sourcing_type === FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE
      ? resolvedSupplierId
      : null;

  const currentStock = parseOptionalNumber(mappedData.current_stock);

  return {
    tenant_id: tenantId,
    product_code: String(mappedData.product_code).trim(),
    product_name: String(mappedData.product_name).trim(),
    unit_of_measure: String(mappedData.unit_of_measure).trim(),
    current_stock: currentStock ?? 0,
    standard_selling_price: parseOptionalNumber(mappedData.standard_selling_price),
    sourcing_type,
    supplier_id,
    manufacturing_date: parseOptionalDate(mappedData.manufacturing_date),
    expiration_date: parseOptionalDate(mappedData.expiration_date),
  };
}

export function buildServiceCatalogCommitInsert(
  mappedData: Record<string, unknown>,
  tenantId: string,
): ServiceCatalogCommitInsert {
  return {
    tenant_id: tenantId,
    service_name: String(mappedData.service_name).trim(),
    description: nullableText(mappedData.description),
    default_rate: parseOptionalNumber(mappedData.default_rate),
    billing_unit: nullableText(mappedData.billing_unit),
    category: nullableText(mappedData.category),
  };
}
