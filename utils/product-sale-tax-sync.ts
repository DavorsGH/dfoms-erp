import type { SupabaseClient } from "@supabase/supabase-js";

import { syncIncomeRegisterTaxLedger } from "@/app/dashboard/finance/tax-ledger-sync";
import {
  computeOutputTax,
  normalizeTaxSettings,
  TAX_SETTINGS_SELECT,
  type TaxSettings,
} from "@/app/dashboard/finance/tax-utils";

type ProductSaleIncomeTaxRow = {
  id: string;
  tenant_id: string;
  date: string;
  amount: number;
  invoice_no: string | null;
  customer_name: string | null;
  client:
    | { client_name: string | null }
    | { client_name: string | null }[]
    | null;
};

const PRODUCT_SALE_TAX_SELECT =
  "id, tenant_id, date, amount, invoice_no, customer_name, client:customers!income_register_client_id_fkey(client_name)";

function resolveCounterpartyName(row: ProductSaleIncomeTaxRow): string | null {
  const client = Array.isArray(row.client) ? (row.client[0] ?? null) : row.client;
  const clientName = client?.client_name?.trim();
  if (clientName) {
    return clientName;
  }

  const customerName = row.customer_name?.trim();
  return customerName || null;
}

async function loadTaxSettingsByTenant(
  supabase: SupabaseClient,
  tenantIds: string[],
): Promise<{ settings: Map<string, TaxSettings | null>; error: string | null }> {
  const settings = new Map<string, TaxSettings | null>();
  if (tenantIds.length === 0) {
    return { settings, error: null };
  }

  const { data, error } = await supabase
    .from("tax_settings")
    .select(TAX_SETTINGS_SELECT)
    .in("tenant_id", tenantIds);

  if (error) {
    return { settings, error: error.message };
  }

  for (const tenantId of tenantIds) {
    const raw = (data ?? []).find(
      (row) => (row as { tenant_id?: string }).tenant_id === tenantId,
    );
    settings.set(
      tenantId,
      normalizeTaxSettings((raw as Partial<TaxSettings> | undefined) ?? null),
    );
  }

  return { settings, error: null };
}

/**
 * Stamp VFRS output tax on freshly created product-sale income rows and sync
 * their tax ledger legs. Forward-only: callers pass the income ids returned by
 * create_product_sale, so pre-existing (historical) sales are never touched.
 *
 * Decisions, matching the Tax Tracking step 1 conventions:
 * - POS/product-sale prices are treated as tax-inclusive retail totals
 *   (tax_inclusive = true), so VFRS is extracted as amount x rate / (100 + rate).
 * - No WHT: walk-in retail buyers do not withhold tax at source. Contract
 *   clients that do withhold are invoiced through Client Invoices instead.
 * - A tenant with vat_registered = false (or a zero VFRS rate) gets no output
 *   tax: net_of_tax_amount = amount and no ledger rows are written.
 *
 * Works with both the browser/RLS client and the service-role admin client;
 * tenant_id read from each income row is passed through explicitly so admin
 * inserts stay tenant-scoped.
 */
export async function syncProductSaleVfrsTax(
  supabase: SupabaseClient,
  incomeIds: string[],
): Promise<{ error: string | null }> {
  const ids = [...new Set(incomeIds.filter(Boolean))];
  if (ids.length === 0) {
    return { error: null };
  }

  const { data, error: fetchError } = await supabase
    .from("income_register")
    .select(PRODUCT_SALE_TAX_SELECT)
    .in("id", ids)
    .eq("entry_type", "product_sale");

  if (fetchError) {
    return { error: fetchError.message };
  }

  const rows = (data as ProductSaleIncomeTaxRow[] | null) ?? [];
  if (rows.length === 0) {
    return { error: null };
  }

  const tenantIds = [...new Set(rows.map((row) => row.tenant_id))];
  const { settings: settingsByTenant, error: settingsError } =
    await loadTaxSettingsByTenant(supabase, tenantIds);

  if (settingsError) {
    return { error: settingsError };
  }

  const errors: string[] = [];

  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    const outputTax = computeOutputTax({
      amount,
      entryType: "product_sale",
      taxInclusive: true,
      settings: settingsByTenant.get(row.tenant_id) ?? null,
    });

    const { error: updateError } = await supabase
      .from("income_register")
      .update({
        tax_inclusive: true,
        net_of_tax_amount: outputTax.netOfTaxAmount,
        output_tax_component: outputTax.component,
        output_vat_amount: outputTax.outputVatAmount,
      })
      .eq("id", row.id);

    if (updateError) {
      errors.push(`income ${row.id}: ${updateError.message}`);
      continue;
    }

    const { error: ledgerError } = await syncIncomeRegisterTaxLedger(supabase, {
      sourceId: row.id,
      entryDate: row.date,
      amount,
      whtRatePct: null,
      whtAmount: 0,
      outputTaxComponent: outputTax.component,
      outputTaxRatePct: outputTax.component ? outputTax.ratePct : null,
      outputVatAmount: outputTax.outputVatAmount,
      counterpartyName: resolveCounterpartyName(row),
      notes: row.invoice_no ? `Product sale ${row.invoice_no}` : null,
      tenantId: row.tenant_id,
    });

    if (ledgerError) {
      errors.push(`income ${row.id}: ${ledgerError}`);
    }
  }

  return { error: errors.length > 0 ? errors.join("; ") : null };
}
