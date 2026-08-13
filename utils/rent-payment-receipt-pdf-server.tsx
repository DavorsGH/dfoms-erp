import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import RentPaymentReceiptPdfDocument from "@/app/dashboard/real-estate/rent-payment-receipt-pdf-document";
import { fetchRentPaymentReceipt } from "@/utils/rent-payment-receipt";
import { resolveRealEstatePdfSignature } from "@/utils/real-estate-pdf-signature";
import { renderPdfBuffer } from "@/utils/render-pdf-buffer";

export type RenderRentPaymentReceiptPdfResult =
  | { ok: true; buffer: Buffer; receiptReference: string }
  | { ok: false; error: string };

export async function renderRentPaymentReceiptPdfBuffer(options: {
  supabase: SupabaseClient;
  tenantId: string;
  entryId: string;
  lesseeId?: string | null;
}): Promise<RenderRentPaymentReceiptPdfResult> {
  const { receipt, error } = await fetchRentPaymentReceipt(options.supabase, {
    tenantId: options.tenantId,
    entryId: options.entryId,
    lesseeId: options.lesseeId,
  });

  if (error) {
    return { ok: false, error };
  }
  if (!receipt) {
    return { ok: false, error: "Rent payment receipt not found." };
  }

  const signature = await resolveRealEstatePdfSignature({
    supabase: options.supabase,
    landlordTenantId: options.tenantId,
  });

  try {
    const buffer = await renderPdfBuffer(
      <RentPaymentReceiptPdfDocument
        receipt={receipt}
        authorizedByName={signature.authorizedByName}
        authorizedByTitle={signature.authorizedByTitle}
        signatureImageUrl={signature.signatureImageUrl}
      />,
    );
    return {
      ok: true,
      buffer,
      receiptReference: receipt.receiptReference,
    };
  } catch (renderError) {
    return {
      ok: false,
      error:
        renderError instanceof Error
          ? renderError.message
          : "Unable to render rent payment receipt PDF.",
    };
  }
}
