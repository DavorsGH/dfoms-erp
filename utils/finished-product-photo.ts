import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAcceptedPropertyPhotoFile } from "@/utils/property-photo";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";

function extensionForFile(file: File): string {
  if (file.type === "image/png") {
    return "png";
  }
  if (file.type === "image/webp") {
    return "webp";
  }
  return "jpg";
}

export function getFinishedProductPhotoStoragePath(
  tenantId: string,
  productId: string,
  file: File,
): string {
  return `${tenantId}/inventory/finished-products/${productId}/${crypto.randomUUID()}.${extensionForFile(file)}`;
}

/**
 * Stores finished product photos in the private tenant-logos bucket (storage path
 * in finished_products.photo_url; display via signed URLs).
 */
export async function uploadFinishedProductPhoto(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
  file: File,
): Promise<
  { storagePath: string; signedUrl: string | null } | { error: string }
> {
  if (!isAcceptedPropertyPhotoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const path = getFinishedProductPhotoStoragePath(tenantId, productId, file);

  const { error: uploadError } = await supabase.storage
    .from(TENANT_LOGOS_BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const signedUrl = await createTenantLogosSignedUrl(supabase, path);

  return { storagePath: path, signedUrl };
}
