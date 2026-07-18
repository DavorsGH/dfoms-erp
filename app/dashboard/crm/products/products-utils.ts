export type CrmProductEntry = {
  id: string;
  name: string;
  product_type: string | null;
  unit_price: number | null;
  billing_cycle: string | null;
  is_active: boolean | null;
  category: string | null;
};

export const ERP_SUITE_CATEGORY = "ERP Suite";

export const CRM_PRODUCT_SELECT =
  "id, name, product_type, unit_price, billing_cycle, is_active, category";

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
