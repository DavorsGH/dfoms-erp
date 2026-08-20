import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";
import {
  getServiceContractDocumentStoragePath,
  resolveServiceContractDocumentContentType,
} from "@/utils/service-contract-document";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";

export async function uploadServiceContractDocument(
  supabase: SupabaseClient,
  tenantId: string,
  contractId: string,
  file: File,
): Promise<
  { storagePath: string; signedUrl: string | null } | { error: string }
> {
  const contentType = resolveServiceContractDocumentContentType(file);
  if (!contentType) {
    return {
      error: "Please upload a PDF, Word document, or image (JPEG, PNG, WebP).",
    };
  }

  const path = getServiceContractDocumentStoragePath(tenantId, contractId, file);

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
