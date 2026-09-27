import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";
import {
  getSupplierContractDocumentStoragePath,
  resolveSupplierContractDocumentContentType,
} from "@/utils/supplier-contract-document";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";

export async function uploadSupplierContractDocument(
  supabase: SupabaseClient,
  tenantId: string,
  contractId: string,
  file: File,
  amendmentId?: string | null,
): Promise<
  { storagePath: string; signedUrl: string | null } | { error: string }
> {
  const contentType = resolveSupplierContractDocumentContentType(file);
  if (!contentType) {
    return {
      error: "Please upload a PDF, Word document, or image (JPEG, PNG, WebP).",
    };
  }

  const path = getSupplierContractDocumentStoragePath(
    tenantId,
    contractId,
    file,
    amendmentId,
  );

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
