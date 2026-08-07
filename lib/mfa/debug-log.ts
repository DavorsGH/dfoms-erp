/**
 * Temporary production instrumentation — remove after live MFA gate is verified.
 * Logs to Vercel Edge (middleware) and Node (server actions) runtime logs.
 */
export function mfaDebugLog(
  site: string,
  payload: Record<string, unknown>,
): void {
  const runtime =
    typeof (globalThis as { EdgeRuntime?: string }).EdgeRuntime === "string"
      ? "edge"
      : "node";

  console.log(
    `[mfa-debug] ${site}`,
    JSON.stringify({
      runtime,
      mfaEnforcementBracket: process.env["MFA_ENFORCEMENT"] ?? "(unset)",
      mfaEnforcementDot: process.env.MFA_ENFORCEMENT ?? "(unset)",
      ...payload,
    }),
  );
}
