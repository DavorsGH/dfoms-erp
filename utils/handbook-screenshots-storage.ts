import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getHandbookScreenshotStoragePath,
  HANDBOOK_SCREENSHOTS_BUCKET,
} from "@/utils/handbook-screenshots-paths";

export {
  getHandbookScreenshotStoragePath,
  HANDBOOK_SCREENSHOTS_BUCKET,
};

/** Signed URLs are regenerated on each fetch — not cached indefinitely. */
export const HANDBOOK_SCREENSHOTS_SIGNED_URL_TTL_SECONDS = 3600;

const PUBLIC_OBJECT_PREFIX = `/storage/v1/object/public/${HANDBOOK_SCREENSHOTS_BUCKET}/`;
const SIGNED_OBJECT_PREFIX = `/storage/v1/object/sign/${HANDBOOK_SCREENSHOTS_BUCKET}/`;

function decodeStoragePath(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Resolve a stored reference (storage path or legacy public/signed URL) to the
 * object path inside handbook-screenshots.
 */
export function extractHandbookScreenshotStoragePath(
  reference: string,
): string | null {
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

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return null;
  }

  return trimmed;
}

export function isExternalNonHandbookScreenshotUrl(reference: string): boolean {
  const trimmed = reference.trim();
  if (!trimmed) {
    return false;
  }
  if (extractHandbookScreenshotStoragePath(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("/")
  );
}

export async function createHandbookScreenshotSignedUrl(
  admin: SupabaseClient,
  reference: string,
  expiresIn = HANDBOOK_SCREENSHOTS_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }

  const path = extractHandbookScreenshotStoragePath(trimmed);
  if (!path) {
    return isExternalNonHandbookScreenshotUrl(trimmed) ? trimmed : null;
  }

  const { data, error } = await admin.storage
    .from(HANDBOOK_SCREENSHOTS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    console.error(
      "[handbook-screenshots-storage] createSignedUrl failed:",
      error?.message ?? "missing signedUrl",
    );
    return null;
  }

  return data.signedUrl;
}

export async function createHandbookScreenshotSignedUrls(
  admin: SupabaseClient,
  references: string[],
  expiresIn = HANDBOOK_SCREENSHOTS_SIGNED_URL_TTL_SECONDS,
): Promise<string[]> {
  const signed = await Promise.all(
    references.map((reference) =>
      createHandbookScreenshotSignedUrl(admin, reference, expiresIn),
    ),
  );
  return signed.filter((url): url is string => Boolean(url));
}

/** Markdown image line for assistant replies (retrieval wiring uses this later). */
export function buildHandbookScreenshotMarkdown(
  signedUrl: string,
  caption?: string | null,
): string {
  const alt = (caption?.trim() || "Handbook screenshot").replace(/[\[\]]/g, "");
  const lines = [`![${alt}](${signedUrl})`];
  if (caption?.trim()) {
    lines.push("", `*${caption.trim()}*`);
  }
  return lines.join("\n");
}
