import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEmployeePhotoStoragePath,
  extractEmployeePhotosStoragePath,
} from "@/utils/employee-photos-storage";
import {
  EMPLOYEE_PHOTOS_BUCKET,
  EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE,
  isAcceptedEmployeePhotoFile,
} from "@/utils/employee-photo";

export function photoExtensionForFile(file: File): "jpg" | "png" | "webp" {
  const type = file.type.toLowerCase();
  if (type === "image/png") {
    return "png";
  }
  if (type === "image/webp") {
    return "webp";
  }
  return "jpg";
}

export function normalizeEmployeePhotoStorageReference(
  reference: string | null | undefined,
  tenantId: string,
  employeeId: string,
): string | null {
  const trimmed = reference?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const path = extractEmployeePhotosStoragePath(trimmed);
  if (!path) {
    return null;
  }
  const scopedTenant = tenantIdFromPath(path);
  if (scopedTenant) {
    return path;
  }
  return buildEmployeePhotoStoragePath(
    tenantId,
    employeeId,
    extensionFromFilename(path),
  );
}

function tenantIdFromPath(path: string): string | null {
  const match = /^([0-9a-f-]{36})\//i.exec(path.trim());
  return match ? match[1] : null;
}

function extensionFromFilename(path: string): "jpg" | "png" | "webp" {
  if (/\.png$/i.test(path)) {
    return "png";
  }
  if (/\.webp$/i.test(path)) {
    return "webp";
  }
  return "jpg";
}

export async function uploadEmployeePhotoServer(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  file: File,
): Promise<{ storagePath: string } | { error: string }> {
  if (!isAcceptedEmployeePhotoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const cleanedTenantId = tenantId.trim();
  const cleanedEmployeeId = employeeId.trim();
  if (!cleanedTenantId || !cleanedEmployeeId) {
    console.error("[employee-photo-upload] missing tenant or employee id");
    return { error: EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE };
  }

  const extension = photoExtensionForFile(file);
  const path = buildEmployeePhotoStoragePath(
    cleanedTenantId,
    cleanedEmployeeId,
    extension,
  );

  const { error: uploadError } = await supabase.storage
    .from(EMPLOYEE_PHOTOS_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
    });

  if (uploadError) {
    console.error(
      "[employee-photo-upload] storage upload failed:",
      uploadError.message,
    );
    return { error: EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE };
  }

  return { storagePath: path };
}
