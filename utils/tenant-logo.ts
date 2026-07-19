import type { SupabaseClient } from "@supabase/supabase-js";

export const TENANT_LOGOS_BUCKET = "tenant-logos";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function getTenantLogoStoragePath(tenantId: string, file: File): string {
  const extension = file.type === "image/png" ? "png" : "jpg";
  return `${tenantId}/logo.${extension}`;
}

export function isAcceptedTenantLogoFile(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase());
}

export async function uploadTenantLogo(
  supabase: SupabaseClient,
  tenantId: string,
  file: File,
): Promise<{ publicUrl: string } | { error: string }> {
  if (!isAcceptedTenantLogoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const path = getTenantLogoStoragePath(tenantId, file);

  const { error: uploadError } = await supabase.storage
    .from(TENANT_LOGOS_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const { data } = supabase.storage.from(TENANT_LOGOS_BUCKET).getPublicUrl(path);

  return { publicUrl: data.publicUrl };
}
