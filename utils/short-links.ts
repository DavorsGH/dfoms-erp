import "server-only";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolvePublicSiteUrl } from "@/utils/public-site-url";

const CODE_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const CODE_LENGTH = 8;
const MAX_INSERT_ATTEMPTS = 8;

/** Hostnames allowed for absolute short-link destinations (exact or subdomain). */
const ALLOWED_REDIRECT_HOST_SUFFIXES = [
  "portal.davorsfacilities.com",
  "portal.davorstechnologies.com",
  "davsuite.com",
  "davsuit.com",
] as const;

/** Paystack hosted checkout / payment pages — exact hostname, https only. */
const PAYSTACK_REDIRECT_EXACT_HOSTS = new Set([
  "checkout.paystack.com",
  "paystack.com",
  "paystack.co",
]);

function siteBaseUrl(): string {
  return resolvePublicSiteUrl();
}

function hostnameFromSiteUrl(siteUrl: string): string | null {
  try {
    return new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedRedirectHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return process.env.NODE_ENV !== "production";
  }

  const configuredHost = hostnameFromSiteUrl(siteBaseUrl());
  const candidates = [
    ...ALLOWED_REDIRECT_HOST_SUFFIXES,
    ...(configuredHost ? [configuredHost] : []),
  ];

  return candidates.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * Relative app paths, DavSuite / portal hosts, or Paystack checkout URLs (https).
 */
export function isAllowedShortLinkDestination(destinationUrl: string): boolean {
  const trimmed = destinationUrl.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return true;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    if (url.username || url.password) {
      return false;
    }

    const host = url.hostname.toLowerCase();
    if (PAYSTACK_REDIRECT_EXACT_HOSTS.has(host)) {
      return url.protocol === "https:";
    }

    return isAllowedRedirectHostname(host);
  } catch {
    return false;
  }
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

  if (!isAllowedShortLinkDestination(destination)) {
    throw new Error("destination_url is not on an allowed host or path");
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

/** Resolve a stored destination to an absolute URL for redirect, or null if disallowed. */
export function resolveDestinationRedirectUrl(
  destinationUrl: string,
): string | null {
  const trimmed = destinationUrl.trim();
  if (!trimmed || !isAllowedShortLinkDestination(trimmed)) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${siteBaseUrl()}${path}`;
}
