import { type NextRequest, NextResponse } from "next/server";
import { AUTH_CONTEXT_HEADER } from "@/lib/middleware-auth-context";

/**
 * Strip client-supplied auth/middleware headers before proxy builds
 * NextResponse.next({ request: { headers } }). Next encodes overrides as
 * x-middleware-request-* on the middleware response; production merges those
 * into req.headers[x-dfoms-auth-context] only (see resolve-routes.js). Routes
 * must never read x-middleware-request-* from headers().
 */
export function sanitizeIncomingProxyRequestHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    const lower = name.toLowerCase();
    if (lower === AUTH_CONTEXT_HEADER) {
      headers.delete(name);
      continue;
    }
    if (
      lower.startsWith("x-middleware-request-") ||
      lower.startsWith("x-middleware-")
    ) {
      headers.delete(name);
    }
  }
}

export function buildSanitizedRequestHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  sanitizeIncomingProxyRequestHeaders(headers);
  return headers;
}

/** Optional: strip client-visible echo on route JSON only (not on proxy responses). */
export function stripLeakedMiddlewareHeaders(
  response: NextResponse,
): NextResponse {
  for (const name of [...response.headers.keys()]) {
    const lower = name.toLowerCase();
    if (
      lower.startsWith("x-middleware-request-") ||
      lower === AUTH_CONTEXT_HEADER
    ) {
      response.headers.delete(name);
    }
  }
  return response;
}

export function proxyPassthrough(request: NextRequest): NextResponse {
  const requestHeaders = buildSanitizedRequestHeaders(request.headers);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
