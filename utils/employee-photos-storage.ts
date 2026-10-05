import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPLOYEE_PHOTOS_BUCKET } from "@/utils/employee-photo";

export const EMPLOYEE_PHOTOS_SIGNED_URL_TTL_SECONDS = 3600;

export type EmployeePhotoSigningRow = {
  employee_id: string;
  tenant_id: string;
  photo_url: string | null;
};

const PUBLIC_OBJECT_PREFIX = `/storage/v1/object/public/${EMPLOYEE_PHOTOS_BUCKET}/`;
const SIGNED_OBJECT_PREFIX = `/storage/v1/object/sign/${EMPLOYEE_PHOTOS_BUCKET}/`;

function decodeStoragePath(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function extractEmployeePhotosStoragePath(reference: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }

  const publicIdx = trimmed.indexOf(PUBLIC_OBJECT_PREFIX);
  if (publicIdx >= 0) {
    return decodeStoragePath(trimmed.slice(publicIdx + PUBLIC_OBJECT_PREFIX.length));
  }

  const signedIdx = trimmed.indexOf(SIGNED_OBJECT_PREFIX);
  if (signedIdx >= 0) {
    const rest = trimmed.slice(signedIdx + SIGNED_OBJECT_PREFIX.length);
    const queryIdx = rest.indexOf("?");
    return decodeStoragePath(queryIdx >= 0 ? rest.slice(0, queryIdx) : rest);
  }

  if (trimmed.includes("/")) {
    return trimmed;
  }

  if (/\.(jpe?g|png|webp)$/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function tenantIdFromEmployeePhotosStoragePath(path: string): string | null {
  const trimmed = path.trim();
  const match = /^([0-9a-f-]{36})\//i.exec(trimmed);
  return match ? match[1] : null;
}

export function buildEmployeePhotoStoragePath(
  tenantId: string,
  employeeId: string,
  extension: "jpg" | "png" | "webp",
): string {
  return `${tenantId.trim()}/${employeeId.trim()}.${extension}`;
}

function extensionFromEmployeePhotoReference(
  reference: string,
): "jpg" | "png" | "webp" {
  const path = extractEmployeePhotosStoragePath(reference) ?? reference;
  if (/\.webp$/i.test(path)) {
    return "webp";
  }
  if (/\.png$/i.test(path)) {
    return "png";
  }
  return "jpg";
}

/**
 * Canonical signing path: `{tenant_id}/{employee_id}.{ext}` only.
 * Uses a tenant-scoped reference when present; otherwise builds from caller ids + extension hint.
 */
export function buildEmployeePhotoSigningPath(
  tenantId: string,
  employeeId: string,
  photoReference: string,
): string | null {
  const reference = photoReference.trim();
  const tenant = tenantId.trim();
  const employee = employeeId.trim();
  if (!reference || !tenant || !employee) {
    return null;
  }

  const extracted = extractEmployeePhotosStoragePath(reference);
  if (extracted) {
    const pathTenant = tenantIdFromEmployeePhotosStoragePath(extracted);
    if (pathTenant) {
      if (pathTenant !== tenant) {
        return null;
      }
      const basename = extracted.slice(pathTenant.length + 1);
      if (!basename.toLowerCase().startsWith(`${employee.toLowerCase()}.`)) {
        return null;
      }
      return extracted;
    }
  }

  return buildEmployeePhotoStoragePath(
    tenant,
    employee,
    extensionFromEmployeePhotoReference(reference),
  );
}

export async function createEmployeePhotosSignedUrlForEmployee(
  admin: SupabaseClient,
  row: EmployeePhotoSigningRow,
  expiresIn = EMPLOYEE_PHOTOS_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const reference = row.photo_url?.trim() ?? "";
  if (!reference) {
    return null;
  }

  const path = buildEmployeePhotoSigningPath(
    row.tenant_id,
    row.employee_id,
    reference,
  );
  if (!path) {
    return null;
  }

  const { data, error } = await admin.storage
    .from(EMPLOYEE_PHOTOS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (!error && data?.signedUrl) {
    return data.signedUrl;
  }

  return null;
}
