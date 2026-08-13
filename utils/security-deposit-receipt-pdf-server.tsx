import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import SecurityDepositReceiptPdfDocument, {
  type SecurityDepositReceiptPdfKind,
} from "@/app/dashboard/real-estate/security-deposit-receipt-pdf-document";
import { fetchSecurityDepositReceipt } from "@/utils/security-deposit-receipt";
import { resolveRealEstatePdfSignature } from "@/utils/real-estate-pdf-signature";
import { renderPdfBuffer } from "@/utils/render-pdf-buffer";

export type RenderSecurityDepositReceiptPdfResult =
  | { ok: true; buffer: Buffer; receiptReference: string; kind: SecurityDepositReceiptPdfKind }
  | { ok: false; error: string };

export async function renderSecurityDepositReceiptPdfBuffer(options: {
  supabase: SupabaseClient;
  tenantId: string;
  depositId: string;
  kind: SecurityDepositReceiptPdfKind;
  lesseeId?: string | null;
}): Promise<RenderSecurityDepositReceiptPdfResult> {
  const { receipt, error } = await fetchSecurityDepositReceipt(options.supabase, {
    tenantId: options.tenantId,
    depositId: options.depositId,
    lesseeId: options.lesseeId,
  });

  if (error) {
    return { ok: false, error };
  }
  if (!receipt) {
    return { ok: false, error: "Security deposit receipt not found." };
  }

  const signature = await resolveRealEstatePdfSignature({
    supabase: options.supabase,
    landlordTenantId: options.tenantId,
  });

  try {
    const buffer = await renderPdfBuffer(
      <SecurityDepositReceiptPdfDocument
        receipt={receipt}
        kind={options.kind}
        authorizedByName={signature.authorizedByName}
        authorizedByTitle={signature.authorizedByTitle}
        signatureImageUrl={signature.signatureImageUrl}
      />,
    );
    const receiptReference =
      options.kind === "resolution"
        ? `${receipt.receiptReference}-resolution`
        : receipt.receiptReference;

    return {
      ok: true,
      buffer,
      receiptReference,
      kind: options.kind,
    };
  } catch (renderError) {
    return {
      ok: false,
      error:
        renderError instanceof Error
          ? renderError.message
          : "Unable to render security deposit receipt PDF.",
    };
  }
}
