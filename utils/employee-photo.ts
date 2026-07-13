import type { SupabaseClient } from "@supabase/supabase-js";

export const EMPLOYEE_PHOTOS_BUCKET = "employee-photos";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function getEmployeePhotoStoragePath(
  employeeId: string,
  file: File,
): string {
  const extension = file.type === "image/png" ? "png" : "jpg";
  return `${employeeId}.${extension}`;
}

export function isAcceptedEmployeePhotoFile(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase());
}

export async function uploadEmployeePhoto(
  supabase: SupabaseClient,
  employeeId: string,
  file: File,
): Promise<{ publicUrl: string } | { error: string }> {
  if (!isAcceptedEmployeePhotoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const path = getEmployeePhotoStoragePath(employeeId, file);

  const { error: uploadError } = await supabase.storage
    .from(EMPLOYEE_PHOTOS_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const { data } = supabase.storage
    .from(EMPLOYEE_PHOTOS_BUCKET)
    .getPublicUrl(path);

  return { publicUrl: data.publicUrl };
}

export function getInitialsFromName(fullName: string | null | undefined): string {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
