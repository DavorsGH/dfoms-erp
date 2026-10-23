import "server-only";

import { randomBytes } from "node:crypto";
import { PASSWORD_MIN_LENGTH } from "@/utils/password-policy";
import { TEMP_PASSWORD_TTL_MS } from "./types";

export { readMustChangeState } from "./must-change-state";

/** Server-side generator that meets length policy. Never log the result. */
export function generateTemporaryPassword(): string {
  const raw = randomBytes(18).toString("base64url");
  const candidate = `${raw}Aa1!`;
  if (candidate.length < PASSWORD_MIN_LENGTH) {
    return `${candidate}${randomBytes(8).toString("base64url")}`;
  }
  return candidate;
}

export function buildMustChangeAppMetadata(
  existing: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...existing,
    must_change_password: true,
    temp_password_expires_at: new Date(
      Date.now() + TEMP_PASSWORD_TTL_MS,
    ).toISOString(),
  };
}

/**
 * Admin Auth updateUserById merges app_metadata (does not replace).
 * Omitting keys leaves them in place — set null to remove, false to clear the gate.
 */
export function clearMustChangeAppMetadata(
  existing: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...existing,
    must_change_password: false,
    temp_password_expires_at: null,
  };
}
