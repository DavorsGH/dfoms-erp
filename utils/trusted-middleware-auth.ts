import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import {
  AUTH_CONTEXT_HEADER,
  verifyAuthContext,
  type MiddlewareAuthContext,
} from "@/lib/middleware-auth-context";

/** Verified signed context from proxy (same request only). */
export const readTrustedMiddlewareAuthContext = cache(
  async (): Promise<MiddlewareAuthContext | null> => {
    const headerStore = await headers();
    return verifyAuthContext(headerStore.get(AUTH_CONTEXT_HEADER));
  },
);
