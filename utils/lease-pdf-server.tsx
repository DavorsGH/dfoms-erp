import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import LeasePdfDocument from "@/app/dashboard/real-estate/lease-pdf-document";
import {
  computeLeaseTermMonths,
  formatTerminationNoticeLabel,
} from "@/app/dashboard/real-estate/leases-utils";
import { fetchLeaseDetail } from "@/utils/lease-management";
import { resolveRealEstatePdfSignature } from "@/utils/real-estate-pdf-signature";
import type { ResendEmailAttachment } from "@/utils/resend-email";
import { renderPdfBuffer } from "@/utils/render-pdf-buffer";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";
import { extractTenantLogosStoragePath } from "@/utils/tenant-logos-storage";

export type RenderLeasePdfResult =
  | { ok: true; buffer: Buffer; filename: string; source: "generated" }
  | { ok: false; error: string };

function leaseAttachmentFilename(leaseId: string, reference?: string | null): string {
  const trimmed = reference?.trim();
  if (trimmed) {
    const segment = trimmed.split("/").pop() ?? trimmed;
    if (/\.[a-z0-9]+$/i.test(segment)) {
      return segment;
    }
  }
  return `lease-${leaseId}.pdf`;
}

function inferDocumentContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

async function downloadCustomLeaseDocument(
  admin: SupabaseClient,
  leaseDocumentUrl: string,
): Promise<Buffer | null> {
  const storagePath = extractTenantLogosStoragePath(leaseDocumentUrl.trim());
  if (!storagePath) {
    return null;
  }

  const { data, error } = await admin.storage
    .from(TENANT_LOGOS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    console.error(
      "[lease-pdf-server] custom lease download failed:",
      error?.message ?? "missing file",
    );
    return null;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return buffer.length > 0 ? buffer : null;
}

export async function renderLeasePdfBuffer(options: {
  supabase: SupabaseClient;
  tenantId: string;
  leaseId: string;
}): Promise<RenderLeasePdfResult> {
  const { detail, fetchError } = await fetchLeaseDetail(
    options.supabase,
    options.tenantId,
    options.leaseId,
  );

  if (fetchError) {
    return { ok: false, error: fetchError };
  }
  if (!detail) {
    return { ok: false, error: "Lease not found." };
  }

  const signature = await resolveRealEstatePdfSignature({
    supabase: options.supabase,
    landlordTenantId: options.tenantId,
  });

  try {
    const buffer = await renderPdfBuffer(
      <LeasePdfDocument
        agreementDate={detail.createdAt.slice(0, 10)}
        landlordName={detail.landlordName}
        landlordAddress={detail.landlordAddress ?? "—"}
        landlordPhone={detail.landlordPhone ?? "—"}
        lesseeName={detail.lesseeName}
        lesseePhone={detail.lesseePhone}
        lesseeEmail={detail.lesseeEmail}
        propertyAddress={detail.propertyAddress}
        propertyStreetAddress={detail.propertyStreetAddress}
        propertyName={detail.propertyName}
        unitNumber={detail.unitNumber}
        locationLabel={detail.propertyLocation}
        startDate={detail.startDate}
        endDate={detail.endDate}
        rentAmountGhs={detail.rentAmountGhs}
        termMonths={computeLeaseTermMonths(detail.startDate, detail.endDate)}
        advanceAmountGhs={detail.advanceRentAmountGhs}
        depositAmountGhs={detail.deposit?.amountGhs ?? null}
        noticePeriodLabel={formatTerminationNoticeLabel(
          detail.terminationNoticeMonths,
        )}
        authorizedByName={signature.authorizedByName}
        authorizedByTitle={signature.authorizedByTitle}
        signatureImageUrl={signature.signatureImageUrl}
      />,
    );

    return {
      ok: true,
      buffer,
      filename: leaseAttachmentFilename(detail.leaseId),
      source: "generated",
    };
  } catch (renderError) {
    return {
      ok: false,
      error:
        renderError instanceof Error
          ? renderError.message
          : "Unable to render lease PDF.",
    };
  }
}

export async function resolveLeaseEmailAttachment(options: {
  supabase: SupabaseClient;
  tenantId: string;
  leaseId: string;
}): Promise<ResendEmailAttachment | null> {
  const { detail, fetchError } = await fetchLeaseDetail(
    options.supabase,
    options.tenantId,
    options.leaseId,
  );

  if (fetchError || !detail) {
    console.error(
      "[lease-pdf-server] lease lookup failed:",
      fetchError ?? "not found",
    );
    return null;
  }

  const customUrl = detail.leaseDocumentUrl?.trim();
  if (customUrl) {
    const buffer = await downloadCustomLeaseDocument(options.supabase, customUrl);
    if (buffer) {
      const filename = leaseAttachmentFilename(detail.leaseId, customUrl);
      return {
        filename,
        content: buffer,
        contentType: inferDocumentContentType(filename),
      };
    }
  }

  const rendered = await renderLeasePdfBuffer(options);
  if (!rendered.ok) {
    console.error("[lease-pdf-server] generated lease PDF failed:", rendered.error);
    return null;
  }

  return {
    filename: rendered.filename,
    content: rendered.buffer,
    contentType: "application/pdf",
  };
}
