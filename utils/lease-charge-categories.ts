export const LEASE_CHARGE_CATEGORIES = [
  "water",
  "electricity",
  "refuse",
  "sewage",
  "security",
  "gardening",
  "service_charge",
] as const;

export type LeaseChargeCategory = (typeof LEASE_CHARGE_CATEGORIES)[number];

export type LeaseChargeBillingMode = "recurring" | "one_off";

export const LEASE_CHARGE_CATEGORY_OPTIONS: Array<{
  value: LeaseChargeCategory;
  label: string;
  group: "utilities" | "service";
}> = [
  { value: "water", label: "Water", group: "utilities" },
  { value: "electricity", label: "Electricity", group: "utilities" },
  { value: "refuse", label: "Refuse", group: "utilities" },
  { value: "sewage", label: "Sewage", group: "utilities" },
  { value: "security", label: "Security", group: "service" },
  { value: "gardening", label: "Gardening", group: "service" },
  { value: "service_charge", label: "Service Charge", group: "service" },
];

export const LEASE_CHARGE_BILLING_MODE_OPTIONS: Array<{
  value: LeaseChargeBillingMode;
  label: string;
}> = [
  { value: "recurring", label: "Recurring (flat monthly)" },
  { value: "one_off", label: "One-off / manual entry only" },
];

export function isLeaseChargeCategory(
  value: string | null | undefined,
): value is LeaseChargeCategory {
  return LEASE_CHARGE_CATEGORIES.includes(value as LeaseChargeCategory);
}

export function isLeaseChargeBillingMode(
  value: string | null | undefined,
): value is LeaseChargeBillingMode {
  return value === "recurring" || value === "one_off";
}

export function formatLeaseChargeCategoryLabel(
  category: LeaseChargeCategory | string,
): string {
  const match = LEASE_CHARGE_CATEGORY_OPTIONS.find(
    (option) => option.value === category,
  );
  return match?.label ?? String(category).replace(/_/g, " ");
}

export function defaultLeaseChargeCategoryLabel(
  category: LeaseChargeCategory,
): string {
  return formatLeaseChargeCategoryLabel(category);
}

export type LeaseChargeSettingRow = {
  chargeCategory: LeaseChargeCategory;
  isBilled: boolean;
  billingMode: LeaseChargeBillingMode;
  flatAmountGhs: number | null;
};

export function createDefaultLeaseChargeSettings(): LeaseChargeSettingRow[] {
  return LEASE_CHARGE_CATEGORIES.map((chargeCategory) => ({
    chargeCategory,
    isBilled: false,
    billingMode: "recurring",
    flatAmountGhs: null,
  }));
}

export function mergeLeaseChargeSettings(
  saved: LeaseChargeSettingRow[],
): LeaseChargeSettingRow[] {
  const byCategory = new Map(
    saved.map((row) => [row.chargeCategory, row] as const),
  );
  return createDefaultLeaseChargeSettings().map((defaults) => {
    const match = byCategory.get(defaults.chargeCategory);
    return match ?? defaults;
  });
}

export function resolveChargeDisplayLabel(options: {
  chargeCategory: string | null | undefined;
  description: string | null | undefined;
}): string {
  const category = options.chargeCategory?.trim();
  if (category && isLeaseChargeCategory(category)) {
    return formatLeaseChargeCategoryLabel(category);
  }
  const description = options.description?.trim();
  return description || "Other charge";
}

export function resolveOneTimeChargeDescription(options: {
  chargeCategory?: LeaseChargeCategory | null;
  description?: string | null;
}): string {
  const manual = options.description?.trim();
  if (manual) {
    return manual;
  }
  if (options.chargeCategory) {
    return defaultLeaseChargeCategoryLabel(options.chargeCategory);
  }
  return "";
}
