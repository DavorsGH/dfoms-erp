import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes as base64url (no padding). */
export function generatePushToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of the raw URL token. Never store the raw token. */
export function hashPushToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
