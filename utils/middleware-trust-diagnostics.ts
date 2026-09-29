import "server-only";

import { headers } from "next/headers";
import {
  AUTH_CONTEXT_HEADER,
  verifyAuthContext,
} from "@/lib/middleware-auth-context";

export type MiddlewareTrustDiagnostics = {
  trustSource: "proxy" | "fallback";
  ctxHeaderPresent: "yes" | "no";
  mwEchoPresent: "yes" | "no";
  clientEchoVisible: "yes" | "no";
};

export async function getMiddlewareTrustDiagnostics(): Promise<MiddlewareTrustDiagnostics> {
  const headerStore = await headers();
  const ctxHeader = headerStore.get(AUTH_CONTEXT_HEADER);
  const mwEcho = headerStore.get(
    "x-middleware-request-x-dfoms-auth-context",
  );
  const trusted = await verifyAuthContext(ctxHeader);
  return {
    trustSource: trusted ? "proxy" : "fallback",
    ctxHeaderPresent: ctxHeader ? "yes" : "no",
    mwEchoPresent: mwEcho ? "yes" : "no",
    clientEchoVisible: mwEcho && !ctxHeader ? "yes" : "no",
  };
}
