import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import {
  AUTH_CONTEXT_HEADER,
  verifyAuthContext,
  type MiddlewareAuthContext,
} from "@/lib/middleware-auth-context";

import type { MiddlewareAuthLoadOptions } from "@/lib/middleware-trust-policy";

export async function resolveTrustedMiddlewareAuthContext(
  options?: MiddlewareAuthLoadOptions,
): Promise<MiddlewareAuthContext | null> {
  if (options?.skipMiddlewareTrust) {
    return null;
  }
  const headerStore = await headers();
  return verifyAuthContext(headerStore.get(AUTH_CONTEXT_HEADER));
}

/** Verified signed context from proxy (same request only). */
export const readTrustedMiddlewareAuthContext = cache(
  async (
    options?: MiddlewareAuthLoadOptions,
  ): Promise<MiddlewareAuthContext | null> =>
    resolveTrustedMiddlewareAuthContext(options),
);
