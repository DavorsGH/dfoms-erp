import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";
import { resolvePdfAssetUrl } from "@/utils/pdf-asset-url";
import {
  extractTenantLogosStoragePath,
  isExternalNonStorageUrl,
} from "@/utils/tenant-logos-storage";

function inferImageContentType(path: string, headerType: string | null): string {
  const fromHeader = headerType?.split(";")[0]?.trim();
  if (fromHeader && fromHeader.startsWith("image/")) {
    return fromHeader;
  }

  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

function bufferToDataUrl(buffer: Buffer, contentType: string): string {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function fetchRemoteImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return null;
    }

    const contentType = inferImageContentType(
      url,
      response.headers.get("content-type"),
    );
    return bufferToDataUrl(buffer, contentType);
  } catch {
    return null;
  }
}

async function downloadTenantLogosImageAsDataUrl(
  admin: SupabaseClient,
  storagePath: string,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(TENANT_LOGOS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    console.error(
      "[pdf-image-source] storage download failed:",
      error?.message ?? "missing file",
    );
    return null;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length === 0) {
    return null;
  }

  const contentType = inferImageContentType(
    storagePath,
    data.type || null,
  );
  return bufferToDataUrl(buffer, contentType);
}

/**
 * Resolve a logo/signature reference to an embeddable data URL for @react-pdf.
 * Prefers direct Supabase storage download for tenant-logos paths (avoids signed-URL fetch issues).
 */
export async function resolvePdfImageDataUrl(options: {
  admin: SupabaseClient;
  reference: string | null | undefined;
  siteBaseUrl?: string | null;
}): Promise<string | null> {
  const trimmed = options.reference?.trim();
  if (!trimmed) {
    return null;
  }

  const storagePath = extractTenantLogosStoragePath(trimmed);
  if (storagePath) {
    const fromStorage = await downloadTenantLogosImageAsDataUrl(
      options.admin,
      storagePath,
    );
    if (fromStorage) {
      return fromStorage;
    }
  }

  const resolvedUrl = resolvePdfAssetUrl(trimmed, options.siteBaseUrl);
  if (!resolvedUrl) {
    return null;
  }

  if (isExternalNonStorageUrl(trimmed) || resolvedUrl.startsWith("http")) {
    return fetchRemoteImageAsDataUrl(resolvedUrl);
  }

  return null;
}
