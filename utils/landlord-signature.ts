import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET, isAcceptedTenantLogoFile } from "@/utils/tenant-logo";

export function getLandlordSignatureStoragePath(
  landlordTenantId: string,
  file: File,
): string {
  const extension =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : "jpg";
  return `${landlordTenantId}/landlord-signature.${extension}`;
}

export async function uploadLandlordSignature(
  supabase: SupabaseClient,
  landlordTenantId: string,
  file: File,
): Promise<{ storagePath: string } | { error: string }> {
  if (!isAcceptedTenantLogoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const path = getLandlordSignatureStoragePath(landlordTenantId, file);

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
