import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";

/** Signed URLs are regenerated on each page load / fetch — not cached indefinitely. */
export const TENANT_LOGOS_SIGNED_URL_TTL_SECONDS = 3600;

const PUBLIC_OBJECT_PREFIX = `/storage/v1/object/public/${TENANT_LOGOS_BUCKET}/`;
const SIGNED_OBJECT_PREFIX = `/storage/v1/object/sign/${TENANT_LOGOS_BUCKET}/`;

function decodeStoragePath(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Resolve a stored reference (storage path or legacy public/signed URL) to the
 * object path inside tenant-logos. Returns null for non-storage URLs (e.g. /logo.jpg).
 */
export function extractTenantLogosStoragePath(reference: string): string | null {
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

  if (/^[0-9a-f-]{36}\//i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function tenantIdFromTenantLogosStoragePath(path: string): string | null {
  const trimmed = path.trim();
  const match = /^([0-9a-f-]{36})\//i.exec(trimmed);
  return match ? match[1] : null;
}

export function isExternalNonStorageUrl(reference: string): boolean {
  const trimmed = reference.trim();
  if (!trimmed) {
    return false;
  }
  if (extractTenantLogosStoragePath(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("/")
  );
}

export async function createTenantLogosSignedUrl(
  admin: SupabaseClient,
  reference: string,
  expiresIn = TENANT_LOGOS_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }

  const path = extractTenantLogosStoragePath(trimmed);
  if (!path) {
    return isExternalNonStorageUrl(trimmed) ? trimmed : null;
  }

  const { data, error } = await admin.storage
    .from(TENANT_LOGOS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    console.error(
      "[tenant-logos-storage] createSignedUrl failed:",
      error?.message ?? "missing signedUrl",
    );
    return null;
  }

  return data.signedUrl;
}

export async function createTenantLogosSignedUrls(
  admin: SupabaseClient,
  references: string[],
  expiresIn = TENANT_LOGOS_SIGNED_URL_TTL_SECONDS,
): Promise<string[]> {
  const signed = await Promise.all(
    references.map((reference) =>
      createTenantLogosSignedUrl(admin, reference, expiresIn),
    ),
  );
  return signed.filter((url): url is string => Boolean(url));
}

export async function createTenantLogosSignedUrlMap(
  admin: SupabaseClient,
  references: string[],
  expiresIn = TENANT_LOGOS_SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    references.map(async (reference) => {
      const signed = await createTenantLogosSignedUrl(admin, reference, expiresIn);
      return signed ? ([reference, signed] as const) : null;
    }),
  );
  return new Map(entries.filter((entry): entry is [string, string] => Boolean(entry)));
}
