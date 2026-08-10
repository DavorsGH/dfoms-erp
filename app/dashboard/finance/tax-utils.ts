import type { SupabaseClient } from "@supabase/supabase-js";

import type { IncomeEntryType } from "./income-register-utils";

export type TaxKind = "wht" | "vat_bundle" | "vfrs";

export type SalesTaxBasis = "service_only" | "total_cost";

export const DEFAULT_SALES_TAX_BASIS: SalesTaxBasis = "service_only";

export const SALES_TAX_BASIS_OPTIONS: Array<{
  value: SalesTaxBasis;
  label: string;
}> = [
  { value: "service_only", label: "Service Cost Only (default)" },
  {
    value: "total_cost",
    label: "Total Cost (Service + Material)",
  },
];

export type OutputTaxComponent = "vat_bundle" | "vfrs";

/** Ghana v1 fallbacks, matching the tax_settings column defaults in script 113. */
export const DEFAULT_VAT_BUNDLE_RATE = 20;
export const DEFAULT_VFRS_RATE = 3;
export const DEFAULT_WHT_RATE = 7.5;
export const DEFAULT_PAYE_RETURN_DUE_DAY = 15;
export const DEFAULT_SSNIT_RETURN_DUE_DAY = 14;
export const DEFAULT_TIER2_RETURN_DUE_DAY = 14;

/** Slim select for Income / Expense / AP forms (defaults + VAT flag). */
export const TAX_SETTINGS_SELECT =
  "tenant_id, vat_registered, default_vat_bundle_rate, default_vfrs_rate, default_wht_rate, sales_tax_basis";

/** Full select for the Statutory Ledger settings editor. */
export const TAX_SETTINGS_FULL_SELECT =
  "tenant_id, vat_registered, gra_tin, default_vat_bundle_rate, default_vfrs_rate, default_wht_rate, sales_tax_basis, vat_return_period, vat_return_due_day, wht_return_due_day, next_vat_due_date, next_wht_due_date, paye_return_due_day, ssnit_return_due_day, tier2_return_due_day, next_paye_due_date, next_ssnit_due_date, next_tier2_due_date, reminder_enabled";

export const TAX_RATE_CATALOG_SELECT =
  "id, tenant_id, tax_kind, code, label, rate_pct, is_active, sort_order";

export type VatReturnPeriod = "monthly" | "quarterly";

export type TaxSettings = {
  tenant_id: string;
  vat_registered: boolean;
  gra_tin: string | null;
  default_vat_bundle_rate: number;
  default_vfrs_rate: number;
  default_wht_rate: number;
  sales_tax_basis: SalesTaxBasis;
  vat_return_period: VatReturnPeriod;
  vat_return_due_day: number | null;
  wht_return_due_day: number | null;
  next_vat_due_date: string | null;
  next_wht_due_date: string | null;
  paye_return_due_day: number;
  ssnit_return_due_day: number;
  tier2_return_due_day: number;
  next_paye_due_date: string | null;
  next_ssnit_due_date: string | null;
  next_tier2_due_date: string | null;
  reminder_enabled: boolean;
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

export function normalizeSalesTaxBasis(value: unknown): SalesTaxBasis {
  return value === "total_cost" ? "total_cost" : "service_only";
}

export function emptyTaxSettings(tenantId: string): TaxSettings {
  return {
    tenant_id: tenantId,
    vat_registered: true,
    gra_tin: null,
    default_vat_bundle_rate: DEFAULT_VAT_BUNDLE_RATE,
    default_vfrs_rate: DEFAULT_VFRS_RATE,
    default_wht_rate: DEFAULT_WHT_RATE,
    sales_tax_basis: DEFAULT_SALES_TAX_BASIS,
    vat_return_period: "monthly",
    vat_return_due_day: null,
    wht_return_due_day: null,
    next_vat_due_date: null,
    next_wht_due_date: null,
    paye_return_due_day: DEFAULT_PAYE_RETURN_DUE_DAY,
    ssnit_return_due_day: DEFAULT_SSNIT_RETURN_DUE_DAY,
    tier2_return_due_day: DEFAULT_TIER2_RETURN_DUE_DAY,
    next_paye_due_date: null,
    next_ssnit_due_date: null,
    next_tier2_due_date: null,
    reminder_enabled: true,
  };
}

function normalizeVatReturnPeriod(
  value: string | null | undefined,
): VatReturnPeriod {
  return value === "quarterly" ? "quarterly" : "monthly";
}

function normalizeOptionalDay(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const day = Number(value);
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return null;
  }

  return Math.trunc(day);
}

function normalizeOptionalDate(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, 10);
}

function normalizeRequiredDay(
  value: number | string | null | undefined,
  fallback: number,
): number {
  const day = normalizeOptionalDay(value);
  return day ?? fallback;
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
    gra_tin: raw.gra_tin?.trim() ? raw.gra_tin.trim() : null,
    default_vat_bundle_rate:
      Number(raw.default_vat_bundle_rate) || DEFAULT_VAT_BUNDLE_RATE,
    default_vfrs_rate: Number(raw.default_vfrs_rate) || DEFAULT_VFRS_RATE,
    default_wht_rate: Number(raw.default_wht_rate) || DEFAULT_WHT_RATE,
    sales_tax_basis: normalizeSalesTaxBasis(raw.sales_tax_basis),
    vat_return_period: normalizeVatReturnPeriod(raw.vat_return_period),
    vat_return_due_day: normalizeOptionalDay(raw.vat_return_due_day),
    wht_return_due_day: normalizeOptionalDay(raw.wht_return_due_day),
    next_vat_due_date: normalizeOptionalDate(raw.next_vat_due_date),
    next_wht_due_date: normalizeOptionalDate(raw.next_wht_due_date),
    paye_return_due_day: normalizeRequiredDay(
      raw.paye_return_due_day,
      DEFAULT_PAYE_RETURN_DUE_DAY,
    ),
    ssnit_return_due_day: normalizeRequiredDay(
      raw.ssnit_return_due_day,
      DEFAULT_SSNIT_RETURN_DUE_DAY,
    ),
    tier2_return_due_day: normalizeRequiredDay(
      raw.tier2_return_due_day,
      DEFAULT_TIER2_RETURN_DUE_DAY,
    ),
    next_paye_due_date: normalizeOptionalDate(raw.next_paye_due_date),
    next_ssnit_due_date: normalizeOptionalDate(raw.next_ssnit_due_date),
    next_tier2_due_date: normalizeOptionalDate(raw.next_tier2_due_date),
    reminder_enabled: raw.reminder_enabled ?? true,
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

export async function loadTenantSalesTaxBasis(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ salesTaxBasis: SalesTaxBasis; error: string | null }> {
  const { data, error } = await supabase
    .from("tax_settings")
    .select("sales_tax_basis")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return { salesTaxBasis: DEFAULT_SALES_TAX_BASIS, error: error.message };
  }

  return {
    salesTaxBasis: normalizeSalesTaxBasis(
      (data as { sales_tax_basis?: string } | null)?.sales_tax_basis,
    ),
    error: null,
  };
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

export type InputTaxComponent = "vat_bundle" | "vfrs";

/**
 * Supplier-side purchase tax (Expense Register / Accounts Payable).
 *
 * `grossBeforeWht` is the supplier invoice total before Davors withholds.
 * Net paid to the supplier (cash / AP liability to the vendor) is
 * gross − WHT. Input VAT is optional and reclaimable separately; the P&L
 * base (`netOfTaxAmount`) is gross − input VAT so reclaimable tax is not
 * expensed. Purchases use vat_bundle for input credit (VFRS is an output
 * scheme for goods sellers, not typical purchase input).
 */
export type PurchaseTaxBreakdown = {
  grossBeforeWht: number;
  whtRatePct: number;
  whtAmount: number;
  netPaidToSupplier: number;
  inputVatAmount: number;
  netOfTaxAmount: number;
  inputTaxComponent: InputTaxComponent | null;
};

export function computePurchaseTaxAmounts(options: {
  grossBeforeWht: number;
  whtRatePct: number;
  whtAmount: number;
  inputVatAmount: number;
}): PurchaseTaxBreakdown {
  const grossBeforeWht = roundTaxAmount(options.grossBeforeWht);
  const whtRatePct = roundTaxRate(options.whtRatePct);
  const whtAmount = Math.max(0, roundTaxAmount(options.whtAmount));
  const inputVatAmount = Math.max(0, roundTaxAmount(options.inputVatAmount));
  const netPaidToSupplier = roundTaxAmount(grossBeforeWht - whtAmount);
  const netOfTaxAmount = roundTaxAmount(
    Math.max(0, grossBeforeWht - inputVatAmount),
  );

  return {
    grossBeforeWht,
    whtRatePct,
    whtAmount,
    netPaidToSupplier,
    inputVatAmount,
    netOfTaxAmount,
    inputTaxComponent: inputVatAmount > 0 ? "vat_bundle" : null,
  };
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
