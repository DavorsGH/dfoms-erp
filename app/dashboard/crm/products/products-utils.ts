export type CrmProductEntry = {
  id: string;
  name: string;
  product_type: string | null;
  unit_price: number | null;
  /** Populated for ERP Suite tiers (USD lives in unit_price). */
  price_ghs?: number | null;
  billing_cycle: string | null;
  is_active: boolean | null;
  category: string | null;
};

export const ERP_SUITE_CATEGORY = "ERP Suite";

export const PLATFORM_BILLING_CATEGORY = "Platform Billing";

/** Synthetic catalog id — not a crm_products row. */
export const PLATFORM_UNIT_ACTIVATION_CATALOG_ID =
  "__catalog_platform_unit_activation__";

export function isErpSuiteCatalogProduct(product: CrmProductEntry): boolean {
  return (product.category ?? "").trim() === ERP_SUITE_CATEGORY;
}

export function isPlatformUnitActivationCatalogProduct(
  product: CrmProductEntry,
): boolean {
  return product.id === PLATFORM_UNIT_ACTIVATION_CATALOG_ID;
}

export function getCatalogManagedLabel(product: CrmProductEntry): string | null {
  if (isErpSuiteCatalogProduct(product)) {
    return "Managed via Tier Pricing";
  }
  if (isPlatformUnitActivationCatalogProduct(product)) {
    return "Managed via Platform Unit Pricing";
  }
  return null;
}

export function buildPlatformUnitActivationCatalogEntry(
  priceGhs: number,
): CrmProductEntry {
  return {
    id: PLATFORM_UNIT_ACTIVATION_CATALOG_ID,
    name: "Platform-only unit activation",
    product_type: DEFAULT_PRODUCT_TYPE,
    category: PLATFORM_BILLING_CATEGORY,
    unit_price: priceGhs,
    billing_cycle: "one_time",
    is_active: true,
  };
}

export const CRM_PRODUCT_SELECT =
  "id, name, product_type, unit_price, price_ghs, billing_cycle, is_active, category";

export const DEFAULT_PRODUCT_TYPE = "service";

export const PRODUCT_TYPE_OPTIONS = [
  { value: "service", label: "Service" },
  { value: "digital_subscription", label: "Digital Subscription" },
  { value: "physical_good", label: "Physical Good" },
] as const;

export const BILLING_CYCLE_OPTIONS = [
  { value: "", label: "None" },
  { value: "one_time", label: "One Time" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

export function formatProductPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Product Catalog Unit Price column — GHS for display. */
export function formatCatalogUnitPrice(product: CrmProductEntry): string {
  if (isErpSuiteCatalogProduct(product)) {
    return formatProductPrice(product.price_ghs);
  }

  return formatProductPrice(product.unit_price);
}

export function formatUsdPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return `USD ${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatActiveStatus(isActive: boolean | null | undefined): string {
  if (isActive === null || isActive === undefined) {
    return "—";
  }

  return isActive ? "Yes" : "No";
}

export function formatProductType(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const match = PRODUCT_TYPE_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value;
}

export function formatBillingCycle(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const match = BILLING_CYCLE_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value;
}

export function getUniqueProductCategories(
  products: readonly CrmProductEntry[],
): string[] {
  const categories = products
    .map((product) => product.category?.trim())
    .filter((category): category is string => Boolean(category));

  return [...new Set(categories)].sort((a, b) => a.localeCompare(b));
}
