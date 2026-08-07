import { mfaDebugLog } from "./debug-log";

/**
 * Read MFA_ENFORCEMENT at runtime using bracket access so Next.js 16 does not
 * inline the build-time value into Edge/Node bundles.
 */
export function readMfaEnforcementRaw(): string | undefined {
  return process.env["MFA_ENFORCEMENT"];
}

/** Sync check — safe for Edge Middleware (no connection() available). */
export function isMfaEnforcementEnabled(): boolean {
  return readMfaEnforcementRaw() === "true";
}

/**
 * Server-side check — opts into dynamic rendering so env is read at request
 * time on Vercel Node (Next.js 16 inlines static process.env.* at build).
 */
export async function isMfaEnforcementEnabledAtRuntime(): Promise<boolean> {
  const { connection } = await import("next/server");
  await connection();
  const raw = readMfaEnforcementRaw();
  const enabled = raw === "true";
  mfaDebugLog("config.isMfaEnforcementEnabledAtRuntime", {
    raw: raw ?? "(unset)",
    enabled,
  });
  return enabled;
}

export function getMfaEnforcementEnvDebug(): {
  raw: string | undefined;
  enabled: boolean;
} {
  const raw = readMfaEnforcementRaw();
  return {
    raw,
    enabled: raw === "true",
  };
}
