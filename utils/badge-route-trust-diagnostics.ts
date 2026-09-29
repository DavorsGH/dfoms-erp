import type { NextResponse } from "next/server";
import {
  getMiddlewareTrustDiagnostics,
  type MiddlewareTrustDiagnostics,
} from "@/utils/middleware-trust-diagnostics";
import { resolveTrustedMiddlewareAuthContext } from "@/utils/trusted-middleware-auth";

export function isTrustDiagEnabled(): boolean {
  return process.env.DFOMS_TRUST_DIAG === "true";
}

export async function loadBadgeRouteTrustDiagnostics(): Promise<{
  headerDiag: MiddlewareTrustDiagnostics;
  trustedContextActive: boolean;
}> {
  const [headerDiag, trusted] = await Promise.all([
    getMiddlewareTrustDiagnostics(),
    resolveTrustedMiddlewareAuthContext(),
  ]);
  return {
    headerDiag,
    trustedContextActive: trusted !== null,
  };
}

export function attachBadgeRouteTrustDiagnosticHeaders(
  response: NextResponse,
  diag: {
    headerDiag: MiddlewareTrustDiagnostics;
    trustedContextActive: boolean;
  },
): void {
  if (!isTrustDiagEnabled()) {
    return;
  }
  response.headers.set(
    "x-dfoms-route-trust-source",
    diag.trustedContextActive ? "proxy" : "fallback",
  );
  response.headers.set(
    "x-dfoms-route-ctx-header-present",
    diag.headerDiag.ctxHeaderPresent,
  );
  response.headers.set(
    "x-dfoms-route-client-echo-visible",
    diag.headerDiag.clientEchoVisible,
  );
  response.headers.set(
    "x-dfoms-route-would-trust-if-enabled",
    diag.headerDiag.trustSource,
  );
}
