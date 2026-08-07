/** When false, MFA gates are no-ops and login behaves exactly as before. */
export function isMfaEnforcementEnabled(): boolean {
  return process.env.MFA_ENFORCEMENT === "true";
}

/**
 * Next.js `npm run dev` loads `.env.local`, not `.env.staging.local`.
 * Set MFA_ENFORCEMENT=true in the env file your dev server actually reads.
 */
export function getMfaEnforcementEnvDebug(): {
  raw: string | undefined;
  enabled: boolean;
} {
  return {
    raw: process.env.MFA_ENFORCEMENT,
    enabled: isMfaEnforcementEnabled(),
  };
}
