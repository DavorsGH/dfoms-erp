import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import ClientReceiptPdfDocument from "@/app/dashboard/finance/client-receipts/client-receipt-pdf-document";
import { normalizeClientReceiptDetail } from "@/app/dashboard/finance/client-receipts/client-receipt-display-utils";
import { loadTenantBillingSettingsHeader } from "@/utils/billing-settings-load";
import { loadTenantGraTin } from "@/app/dashboard/finance/tax-utils";
import { loadClientReceiptDetail } from "@/utils/client-invoice-payments-api";
import { resolvePdfBrandingImages } from "@/utils/pdf-branding-images";
import { renderPdfBuffer } from "@/utils/render-pdf-buffer";
import { getTenantBrandingById } from "@/utils/tenant-branding";

export type RenderClientReceiptPdfResult =
  | { ok: true; buffer: Buffer; receiptNumber: string }
  | { ok: false; error: string };

export async function renderClientReceiptPdfBuffer(options: {
  supabase: SupabaseClient;
  tenantId: string;
  receiptId: string;
}): Promise<RenderClientReceiptPdfResult> {
  const detail = await loadClientReceiptDetail(
    options.supabase,
    options.tenantId,
    options.receiptId,
  );

  if (detail.error || !detail.receipt || !detail.invoice) {
    return {
      ok: false,
      error: detail.error ?? "Receipt not found.",
    };
  }

  const [branding, billingSettings, graTin] = await Promise.all([
    getTenantBrandingById(options.tenantId),
    loadTenantBillingSettingsHeader(options.supabase, options.tenantId),
    loadTenantGraTin(options.supabase, options.tenantId),
  ]);

  const display = {
    ...normalizeClientReceiptDetail({
      receipt: detail.receipt,
      invoice: detail.invoice,
    }),
    branding,
    billingSettings,
    graTin,
  };

  const { logoUrl, signatureImageUrl } = await resolvePdfBrandingImages({
    supabase: options.supabase,
    tenantId: options.tenantId,
    branding,
  });

  try {
    const buffer = await renderPdfBuffer(
      <ClientReceiptPdfDocument
        {...display}
        logoUrl={logoUrl}
        signatureImageUrl={signatureImageUrl}
      />,
    );

    return {
      ok: true,
      buffer,
      receiptNumber: display.receipt.receipt_number,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to render client receipt PDF.",
    };
  }
}
