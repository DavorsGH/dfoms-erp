import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET, isAcceptedTenantLogoFile } from "@/utils/tenant-logo";

export function getTenantSignatureStoragePath(tenantId: string, file: File): string {
  const extension = file.type === "image/png" ? "png" : "jpg";
  return `${tenantId}/signature.${extension}`;
}

export async function uploadTenantSignature(
  supabase: SupabaseClient,
  tenantId: string,
  file: File,
): Promise<{ storagePath: string } | { error: string }> {
  if (!isAcceptedTenantLogoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const path = getTenantSignatureStoragePath(tenantId, file);

  const { error: uploadError } = await supabase.storage
    .from(TENANT_LOGOS_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  return { storagePath: path };
}
