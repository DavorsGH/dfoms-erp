import "server-only";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/utils/supabase/admin";

const CODE_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const CODE_LENGTH = 8;
const MAX_INSERT_ATTEMPTS = 8;

function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://portal.davorsfacilities.com"
  ).replace(/\/$/, "");
}

function generateShortCode(length = CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    (typeof error.message === "string" &&
      /duplicate key|unique constraint/i.test(error.message))
  );
}

/**
 * Persist an absolute destination URL and return `{site}/s/{code}`.
 * Retries on code collision. Throws if insert fails for other reasons.
 */
export async function createShortLinkUrl(
  destinationUrl: string,
  options?: { expiresAt?: Date | null },
): Promise<string> {
  const destination = destinationUrl.trim();
  if (!destination) {
    throw new Error("destination_url is required");
  }

  const admin = createAdminClient();
  const expiresAt =
    options?.expiresAt === undefined
      ? null
      : options.expiresAt
        ? options.expiresAt.toISOString()
        : null;

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const code = generateShortCode();
    const { error } = await admin.from("short_links").insert({
      code,
      destination_url: destination,
      expires_at: expiresAt,
    });

    if (!error) {
      return `${siteBaseUrl()}/s/${code}`;
    }

    if (isUniqueViolation(error)) {
      continue;
    }

    throw new Error(error.message);
  }

  throw new Error("Could not allocate a unique short-link code.");
}

/**
 * Look up a short code. Returns null if missing or expired.
 */
export async function lookupShortLinkDestination(
  code: string,
): Promise<string | null> {
  const cleaned = code.trim();
  if (!cleaned) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("short_links")
    .select("destination_url, expires_at")
    .eq("code", cleaned)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.destination_url) {
    return null;
  }

  if (data.expires_at) {
    const expiresMs = Date.parse(data.expires_at);
    if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
      return null;
    }
  }

  return data.destination_url.trim() || null;
}

/** Resolve a stored destination to an absolute URL for redirect. */
export function resolveDestinationRedirectUrl(destinationUrl: string): string {
  const trimmed = destinationUrl.trim();
  if (!trimmed) {
    throw new Error("Empty destination_url");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${siteBaseUrl()}${path}`;
}
