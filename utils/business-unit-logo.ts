import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isAcceptedTenantLogoFile,
  TENANT_LOGOS_BUCKET,
} from "@/utils/tenant-logo";

export function getBusinessUnitLogoStoragePath(
  tenantId: string,
  businessUnitId: string,
  file: File,
): string {
  const extension = file.type === "image/png" ? "png" : "jpg";
  return `${tenantId}/business-units/${businessUnitId}/logo.${extension}`;
}

/**
 * Uploads a business-unit logo to the private tenant-logos bucket.
 * Returns the storage path to store in business_units.logo_url.
 */
export async function uploadBusinessUnitLogo(
  supabase: SupabaseClient,
  tenantId: string,
  businessUnitId: string,
  file: File,
): Promise<{ storagePath: string } | { error: string }> {
  if (!isAcceptedTenantLogoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const path = getBusinessUnitLogoStoragePath(tenantId, businessUnitId, file);

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
