import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import ClientQuotationPdfDocument from "@/app/dashboard/sales-crm/quotations/client-quotation-pdf-document";
import { normalizeClientQuotationDetail } from "@/app/dashboard/sales-crm/quotations/client-quotation-display-utils";
import { loadTenantBillingSettingsHeader } from "@/utils/billing-settings-load";
import { loadTenantGraTin } from "@/app/dashboard/finance/tax-utils";
import { loadClientQuotationDetail } from "@/utils/client-quotations-api";
import { resolvePdfBrandingImages } from "@/utils/pdf-branding-images";
import { renderPdfBuffer } from "@/utils/render-pdf-buffer";
import { PAYMENT_ACCOUNT_SELECT, type PaymentAccountRow } from "@/utils/payment-accounts-types";
import { getTenantBrandingById } from "@/utils/tenant-branding";

export type RenderClientQuotationPdfResult =
  | { ok: true; buffer: Buffer; quotationNumber: string }
  | { ok: false; error: string };

export async function renderClientQuotationPdfBuffer(options: {
  supabase: SupabaseClient;
  tenantId: string;
  quotationId: string;
}): Promise<RenderClientQuotationPdfResult> {
  const detail = await loadClientQuotationDetail(
    options.supabase,
    options.tenantId,
    options.quotationId,
  );

  if (detail.error || !detail.quotation) {
    return {
      ok: false,
      error: detail.error ?? "Quotation not found.",
    };
  }

  let paymentAccounts: PaymentAccountRow[] = [];
  if (detail.payment_account_ids.length > 0) {
    const { data, error } = await options.supabase
      .from("payment_accounts")
      .select(PAYMENT_ACCOUNT_SELECT)
      .eq("tenant_id", options.tenantId)
      .in("id", detail.payment_account_ids);

    if (error) {
      return { ok: false, error: error.message };
    }

    paymentAccounts = (data as PaymentAccountRow[] | null) ?? [];
  }

  const [branding, billingSettings, graTin] = await Promise.all([
    getTenantBrandingById(options.tenantId),
    loadTenantBillingSettingsHeader(options.supabase, options.tenantId),
    loadTenantGraTin(options.supabase, options.tenantId),
  ]);

  const display = normalizeClientQuotationDetail({
    client_quotation: detail.quotation,
    line_items: detail.line_items,
    payment_account_ids: detail.payment_account_ids,
    payment_accounts: paymentAccounts,
  });
  display.branding = branding;
  display.billingSettings = billingSettings;
  display.graTin = graTin;

  const { logoUrl, signatureImageUrl } = await resolvePdfBrandingImages({
    supabase: options.supabase,
    tenantId: options.tenantId,
    branding,
  });

  try {
    const buffer = await renderPdfBuffer(
      <ClientQuotationPdfDocument
        {...display}
        logoUrl={logoUrl}
        signatureImageUrl={signatureImageUrl}
      />,
    );

    return {
      ok: true,
      buffer,
      quotationNumber: display.quotation.quotation_number,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to render client quotation PDF.",
    };
  }
}
