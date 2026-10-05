import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPLOYEE_PHOTOS_BUCKET } from "@/utils/employee-photo";

export const EMPLOYEE_PHOTOS_SIGNED_URL_TTL_SECONDS = 3600;

/** Set to false after production flat-path migration; then remove `, path` on line 118. */
export const EMPLOYEE_PHOTOS_ALLOW_LEGACY_FLAT_PATH = true;

export type EmployeePhotoSigningRow = {
  employee_id: string;
  tenant_id: string;
  photo_url: string | null;
};

const PUBLIC_OBJECT_PREFIX = `/storage/v1/object/public/${EMPLOYEE_PHOTOS_BUCKET}/`;
const SIGNED_OBJECT_PREFIX = `/storage/v1/object/sign/${EMPLOYEE_PHOTOS_BUCKET}/`;
const TENANT_PATH_PREFIX = /^[0-9a-f-]{36}\//i;

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

async function objectExists(
  admin: SupabaseClient,
  path: string,
): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await admin.storage
    .from(EMPLOYEE_PHOTOS_BUCKET)
    .list(folder, { search: name, limit: 1 });
  if (error) {
    return false;
  }
  return (data ?? []).some((row) => row.name === name);
}

export async function resolveEmployeePhotoSigningPaths(
  admin: SupabaseClient,
  tenantId: string,
  reference: string,
  options?: { allowLegacyFlatPath?: boolean },
): Promise<string[]> {
  const allowLegacyFlatPath =
    options?.allowLegacyFlatPath ?? EMPLOYEE_PHOTOS_ALLOW_LEGACY_FLAT_PATH;

  const path = extractEmployeePhotosStoragePath(reference);
  if (!path) {
    return [];
  }

  const scopedTenantId = tenantIdFromEmployeePhotosStoragePath(path);
  if (scopedTenantId) {
    if (scopedTenantId !== tenantId.trim()) {
      return [];
    }
    return [path];
  }

  const tenantScoped = `${tenantId.trim()}/${path}`;
  const candidates: string[] = TENANT_PATH_PREFIX.test(path)
    ? [path]
    : allowLegacyFlatPath
      ? [tenantScoped, path]
      : [tenantScoped];
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await objectExists(admin, candidate)) {
      existing.push(candidate);
    }
  }
  if (existing.length > 0) {
    return existing;
  }
  return candidates;
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

  const paths = await resolveEmployeePhotoSigningPaths(
    admin,
    row.tenant_id,
    reference,
  );
  for (const path of paths) {
    const { data, error } = await admin.storage
      .from(EMPLOYEE_PHOTOS_BUCKET)
      .createSignedUrl(path, expiresIn);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  }

  return null;
}

export async function createEmployeePhotosSignedUrl(
  admin: SupabaseClient,
  tenantId: string,
  reference: string,
  expiresIn = EMPLOYEE_PHOTOS_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }

  const paths = await resolveEmployeePhotoSigningPaths(admin, tenantId, trimmed);
  for (const path of paths) {
    const { data, error } = await admin.storage
      .from(EMPLOYEE_PHOTOS_BUCKET)
      .createSignedUrl(path, expiresIn);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  }

  return null;
}
