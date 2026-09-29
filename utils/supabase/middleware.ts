import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_PERSIST_FLAG_COOKIE,
  readAuthPersistEnabled,
} from "@/lib/auth/session-persistence";
import { applyAuthCookiePersistence } from "@/utils/supabase/auth-cookie-options";
import { noStoreFetch } from "@/utils/supabase/no-store-fetch";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function isSupabaseAuthHttpUrl(url: string): boolean {
  return url.includes("/auth/v1/");
}

export type MiddlewareSupabaseClientOptions = {
  /** Invoked once per outbound Supabase Auth HTTP request (JWKS, refresh, etc.). */
  onSupabaseAuthHttp?: () => void;
};

export const createClient = (
  request: NextRequest,
  options?: MiddlewareSupabaseClientOptions,
) => {
  // Create an unmodified response
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const onAuthHttp = options?.onSupabaseAuthHttp;
  const middlewareFetch: typeof fetch = (input, init) => {
    if (onAuthHttp) {
      try {
        if (isSupabaseAuthHttpUrl(resolveFetchUrl(input))) {
          onAuthHttp();
        }
      } catch {
        // ignore URL parse failures
      }
    }
    return noStoreFetch(input, init);
  };

  const supabase = createServerClient(
    supabaseUrl!,
    supabaseKey!,
    {
      global: {
        fetch: middlewareFetch,
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          const persist = readAuthPersistEnabled(
            request.cookies.get(AUTH_PERSIST_FLAG_COOKIE)?.value,
          );
          const adjusted = applyAuthCookiePersistence(cookiesToSet, persist);
          adjusted.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          adjusted.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          for (const [name, value] of Object.entries(headers ?? {})) {
            supabaseResponse.headers.set(name, value)
          }
        },
      },
    },
  );

  return { supabase, response: supabaseResponse }
};
