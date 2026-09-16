import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const SVIX_TOLERANCE_SECONDS = 5 * 60;

function decodeSvixSecret(secret: string): Buffer | null {
  const trimmed = secret.trim();
  if (!trimmed) {
    return null;
  }
  const raw = trimmed.startsWith("whsec_") ? trimmed.slice(6) : trimmed;
  try {
    return Buffer.from(raw, "base64");
  } catch {
    return null;
  }
}

function parseSignatures(header: string): string[] {
  return header
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const comma = part.indexOf(",");
      if (comma === -1) {
        return part;
      }
      return part.slice(comma + 1).trim();
    })
    .filter(Boolean);
}

function secureCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Verify Resend webhook signatures (Svix-compatible).
 * Returns false when secret is missing, headers invalid, or signature mismatch.
 */
export function verifyResendWebhookSignature(options: {
  rawBody: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  secret: string | null | undefined;
}): boolean {
  const secretBytes = decodeSvixSecret(options.secret ?? "");
  if (!secretBytes) {
    return false;
  }

  const svixId = options.svixId?.trim() ?? "";
  const svixTimestamp = options.svixTimestamp?.trim() ?? "";
  const svixSignature = options.svixSignature?.trim() ?? "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > SVIX_TOLERANCE_SECONDS) {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${options.rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest();

  const candidates = parseSignatures(svixSignature);
  for (const encoded of candidates) {
    try {
      const received = Buffer.from(encoded, "base64");
      if (secureCompare(expected, received)) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}
