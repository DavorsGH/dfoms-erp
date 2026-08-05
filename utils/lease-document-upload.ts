import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";
import {
  getLeaseDocumentStoragePath,
  resolveLeaseDocumentContentType,
} from "@/utils/lease-document";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";

/**
 * Uploads a custom lease PDF/Word file into the tenant-logos bucket.
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
  const contentType = resolveLeaseDocumentContentType(file);
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
