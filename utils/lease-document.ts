import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const LEASE_DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const LEASE_DOCUMENT_HINT = "PDF, DOC, or DOCX.";

function extensionFromFileName(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

function resolveContentType(file: File): string | null {
  const mime = file.type.toLowerCase().trim();
  if (mime && ACCEPTED_MIME_TYPES.has(mime)) {
    return mime;
  }
  const ext = extensionFromFileName(file.name);
  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }
  return null;
}

export function isAcceptedLeaseDocumentFile(file: File): boolean {
  return resolveContentType(file) != null;
}

export function getLeaseDocumentStoragePath(
  tenantId: string,
  leaseId: string,
  file: File,
): string {
  const contentType = resolveContentType(file) ?? "application/pdf";
  const extension =
    EXTENSION_BY_MIME[contentType] ??
    extensionFromFileName(file.name) ??
    "pdf";
  return `${tenantId}/real-estate/lease/${leaseId}/${crypto.randomUUID()}.${extension}`;
}

/**
 * Uploads a custom lease PDF/Word file into the existing tenant-logos bucket.
 * Callers persist the returned storage path on leases.lease_document_url.
 */
export async function uploadLeaseDocument(
  supabase: SupabaseClient,
  tenantId: string,
  leaseId: string,
  file: File,
): Promise<
  { storagePath: string; signedUrl: string | null } | { error: string }
> {
  const contentType = resolveContentType(file);
  if (!contentType) {
    return {
      error: "Please upload a PDF, DOC, or DOCX lease document.",
    };
  }

  const path = getLeaseDocumentStoragePath(tenantId, leaseId, file);

  const { error: uploadError } = await supabase.storage
    .from(TENANT_LOGOS_BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const signedUrl = await createTenantLogosSignedUrl(supabase, path);

  return { storagePath: path, signedUrl };
}
