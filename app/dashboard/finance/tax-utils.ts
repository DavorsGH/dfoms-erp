import type { IncomeEntryType } from "./income-register-utils";

export type TaxKind = "wht" | "vat_bundle" | "vfrs";

export type OutputTaxComponent = "vat_bundle" | "vfrs";

/** Ghana v1 fallbacks, matching the tax_settings column defaults in script 113. */
export const DEFAULT_VAT_BUNDLE_RATE = 20;
export const DEFAULT_VFRS_RATE = 3;
export const DEFAULT_WHT_RATE = 7.5;

export const TAX_SETTINGS_SELECT =
  "tenant_id, vat_registered, default_vat_bundle_rate, default_vfrs_rate, default_wht_rate";

export const TAX_RATE_CATALOG_SELECT =
  "id, tenant_id, tax_kind, code, label, rate_pct, is_active, sort_order";

export type TaxSettings = {
  tenant_id: string;
  vat_registered: boolean;
  default_vat_bundle_rate: number;
  default_vfrs_rate: number;
  default_wht_rate: number;
};

export type TaxRateCatalogEntry = {
  id: string;
  tenant_id: string | null;
  tax_kind: TaxKind;
  code: string;
  label: string;
  rate_pct: number;
  is_active: boolean;
  sort_order: number;
};

export function roundTaxAmount(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function roundTaxRate(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function normalizeTaxSettings(
  raw: Partial<TaxSettings> | null | undefined,
): TaxSettings | null {
  if (!raw?.tenant_id) {
    return null;
  }

  return {
    tenant_id: raw.tenant_id,
    vat_registered: raw.vat_registered ?? true,
    default_vat_bundle_rate:
      Number(raw.default_vat_bundle_rate) || DEFAULT_VAT_BUNDLE_RATE,
    default_vfrs_rate: Number(raw.default_vfrs_rate) || DEFAULT_VFRS_RATE,
    default_wht_rate: Number(raw.default_wht_rate) || DEFAULT_WHT_RATE,
  };
}

export function normalizeTaxRateCatalogEntry(
  raw: TaxRateCatalogEntry,
): TaxRateCatalogEntry {
  return {
    ...raw,
    tenant_id: raw.tenant_id ?? null,
    rate_pct: Number(raw.rate_pct) || 0,
    sort_order: Number(raw.sort_order) || 0,
  };
}

/**
 * Tenant overrides win over system defaults (tenant_id IS NULL) sharing a code,
 * so a tenant can restate e.g. WHT_7_5 at a different rate without losing the
 * remaining system options.
 */
export function selectTaxRateOptions(
  catalog: TaxRateCatalogEntry[],
  taxKind: TaxKind,
): TaxRateCatalogEntry[] {
  const byCode = new Map<string, TaxRateCatalogEntry>();

  for (const entry of catalog) {
    if (entry.tax_kind !== taxKind || !entry.is_active) {
      continue;
    }

    const existing = byCode.get(entry.code);
    if (existing && existing.tenant_id !== null) {
      continue;
    }

    byCode.set(entry.code, entry);
  }

  return [...byCode.values()].sort(
    (left, right) =>
      left.sort_order - right.sort_order || left.rate_pct - right.rate_pct,
  );
}

export function resolveDefaultWhtRate(settings: TaxSettings | null): number {
  return settings ? settings.default_wht_rate : DEFAULT_WHT_RATE;
}

export function resolveOutputTaxComponent(
  entryType: IncomeEntryType,
): OutputTaxComponent {
  // income_register_output_tax_component_check pins service -> vat_bundle and
  // product_sale -> vfrs, so entry_type alone decides the treatment.
  return entryType === "product_sale" ? "vfrs" : "vat_bundle";
}

export function resolveOutputTaxRate(
  entryType: IncomeEntryType,
  settings: TaxSettings | null,
): number {
  if (entryType === "product_sale") {
    return settings ? settings.default_vfrs_rate : DEFAULT_VFRS_RATE;
  }

  return settings ? settings.default_vat_bundle_rate : DEFAULT_VAT_BUNDLE_RATE;
}

export type OutputTaxBreakdown = {
  component: OutputTaxComponent | null;
  ratePct: number;
  outputVatAmount: number;
  netOfTaxAmount: number;
};

/**
 * Output tax on an income row.
 *
 * tax_inclusive = true (the DB default, and how client invoices reach the Income
 * Register — client_invoices.total_amount_due is subtotal + tax_due, so the
 * synced `amount` already carries the tax):
 *   output_vat = amount * rate / (100 + rate)
 *   net        = amount - output_vat
 * tax_inclusive = false (amount is already net, tax sits on top):
 *   output_vat = amount * rate / 100
 *   net        = amount
 *
 * The same split applies to product-sale VFRS; only the rate differs.
 * A tenant flagged vat_registered = false charges no output tax at all.
 */
export function computeOutputTax(options: {
  amount: number;
  entryType: IncomeEntryType;
  taxInclusive: boolean;
  settings: TaxSettings | null;
}): OutputTaxBreakdown {
  const amount = Number(options.amount) || 0;
  const ratePct = roundTaxRate(
    resolveOutputTaxRate(options.entryType, options.settings),
  );

  if (options.settings?.vat_registered === false || ratePct <= 0) {
    return {
      component: null,
      ratePct: 0,
      outputVatAmount: 0,
      netOfTaxAmount: roundTaxAmount(amount),
    };
  }

  const outputVatAmount = roundTaxAmount(
    options.taxInclusive
      ? (amount * ratePct) / (100 + ratePct)
      : (amount * ratePct) / 100,
  );

  return {
    component: resolveOutputTaxComponent(options.entryType),
    ratePct,
    outputVatAmount,
    netOfTaxAmount: roundTaxAmount(
      options.taxInclusive ? amount - outputVatAmount : amount,
    ),
  };
}

export function computeWhtAmount(amount: number, ratePct: number): number {
  // Withheld on the gross invoice amount; the form keeps the field editable for
  // clients that withhold on a different base.
  return roundTaxAmount(((Number(amount) || 0) * (Number(ratePct) || 0)) / 100);
}

const OUTPUT_TAX_LABELS: Record<OutputTaxComponent, string> = {
  vat_bundle: "VAT/NHIL/GETFund",
  vfrs: "VFRS",
};

export function getOutputTaxLabel(component: OutputTaxComponent): string {
  return OUTPUT_TAX_LABELS[component];
}

export function formatOutputTaxHint(
  breakdown: OutputTaxBreakdown,
  taxInclusive: boolean,
  formatMoney: (value: number) => string,
): string | null {
  if (!breakdown.component || breakdown.outputVatAmount <= 0) {
    return null;
  }

  const label = `${getOutputTaxLabel(breakdown.component)} (${breakdown.ratePct}%)`;

  return taxInclusive
    ? `Includes ${formatMoney(breakdown.outputVatAmount)} ${label}`
    : `Plus ${formatMoney(breakdown.outputVatAmount)} ${label} on top`;
}

/** GRA period bucket: first day of the entry month, as tax_ledger_entries requires. */
export function toPeriodMonth(entryDate: string): string {
  return `${entryDate.slice(0, 7)}-01`;
}
