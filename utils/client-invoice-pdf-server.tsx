import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import ClientInvoicePdfDocument from "@/app/dashboard/finance/client-invoices/client-invoice-pdf-document";
import {
  normalizeClientInvoiceDetail,
  type ClientInvoiceDetailPayload,
} from "@/app/dashboard/finance/client-invoices/client-invoice-display-utils";
import { loadTenantBillingSettingsHeader } from "@/utils/billing-settings-load";
import { loadTenantGraTin } from "@/app/dashboard/finance/tax-utils";
import { loadClientInvoiceDetail } from "@/utils/client-invoices-api";
import { resolvePdfBrandingImages } from "@/utils/pdf-branding-images";
import { renderPdfBuffer } from "@/utils/render-pdf-buffer";
import { PAYMENT_ACCOUNT_SELECT, type PaymentAccountRow } from "@/utils/payment-accounts-types";
import { getTenantBrandingById } from "@/utils/tenant-branding";
import { loadBusinessUnitDocumentContact } from "@/utils/business-unit-document-contact";

export type RenderClientInvoicePdfResult =
  | {
      ok: true;
      buffer: Buffer;
      invoiceNumber: string;
    }
  | { ok: false; error: string };

export async function renderClientInvoicePdfBuffer(options: {
  supabase: SupabaseClient;
  tenantId: string;
  invoiceId: string;
}): Promise<RenderClientInvoicePdfResult> {
  const detail = await loadClientInvoiceDetail(
    options.supabase,
    options.tenantId,
    options.invoiceId,
  );

  if (detail.error || !detail.invoice) {
    return {
      ok: false,
      error: detail.error ?? "Invoice not found.",
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

  const [branding, billingSettings, graTin, businessUnitContact] =
    await Promise.all([
      getTenantBrandingById(options.tenantId),
      loadTenantBillingSettingsHeader(options.supabase, options.tenantId),
      loadTenantGraTin(options.supabase, options.tenantId),
      loadBusinessUnitDocumentContact(
        options.supabase,
        options.tenantId,
        detail.invoice.business_unit_id,
      ),
    ]);

  const payload: ClientInvoiceDetailPayload = {
    client_invoice: detail.invoice,
    line_items: detail.line_items,
    payment_account_ids: detail.payment_account_ids,
    payment_accounts: paymentAccounts,
    business_unit_contact: businessUnitContact,
  };

  const display = normalizeClientInvoiceDetail(payload);
  display.branding = branding;
  display.billingSettings = billingSettings;
  display.graTin = graTin;
  display.businessUnitContact = businessUnitContact;

  const { logoUrl, signatureImageUrl } = await resolvePdfBrandingImages({
    supabase: options.supabase,
    tenantId: options.tenantId,
    branding,
    businessUnitContact,
  });

  try {
    const buffer = await renderPdfBuffer(
      <ClientInvoicePdfDocument
        {...display}
        logoUrl={logoUrl}
        signatureImageUrl={signatureImageUrl}
      />,
    );

    return {
      ok: true,
      buffer,
      invoiceNumber: display.invoice.invoice_number,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to render client invoice PDF.",
    };
  }
}
