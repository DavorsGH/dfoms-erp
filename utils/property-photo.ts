import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isAcceptedPropertyPhotoFile(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase());
}

function extensionForFile(file: File): string {
  if (file.type === "image/png") {
    return "png";
  }
  if (file.type === "image/webp") {
    return "webp";
  }
  return "jpg";
}

export type RealEstatePhotoEntity =
  | "property"
  | "unit"
  | "lease"
  | "maintenance"
  | "inspection"
  | "expense"
  | "lessee"
  | "rental_application";

export function getPropertyPhotoStoragePath(
  tenantId: string,
  entity: RealEstatePhotoEntity,
  entityId: string,
  file: File,
): string {
  const extension = extensionForFile(file);
  return `${tenantId}/real-estate/${entity}/${entityId}/${crypto.randomUUID()}.${extension}`;
}

/**
 * Uploads a real-estate photo/receipt into the existing tenant-logos bucket
 * (property, unit, lease, maintenance, inspection, expense, or lessee profile).
 */
export async function uploadPropertyPhoto(
  supabase: SupabaseClient,
  tenantId: string,
  entity: RealEstatePhotoEntity,
  entityId: string,
  file: File,
): Promise<{ publicUrl: string } | { error: string }> {
  if (!isAcceptedPropertyPhotoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const path = getPropertyPhotoStoragePath(tenantId, entity, entityId, file);

  const { error: uploadError } = await supabase.storage
    .from(TENANT_LOGOS_BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const { data } = supabase.storage
    .from(TENANT_LOGOS_BUCKET)
    .getPublicUrl(path);

  return { publicUrl: data.publicUrl };
}
