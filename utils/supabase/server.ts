import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  AUTH_PERSIST_FLAG_COOKIE,
  readAuthPersistEnabled,
} from "@/lib/auth/session-persistence";
import { applyAuthCookiePersistence } from "@/utils/supabase/auth-cookie-options";
import { noStoreFetch } from "@/utils/supabase/no-store-fetch";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export type CreateServerClientOptions = {
  /** When set at login time, overrides the dfoms-auth-persist cookie for this response. */
  authPersist?: boolean;
};

export const createClient = (
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  options?: CreateServerClientOptions,
) => {
  return createServerClient(supabaseUrl!, supabaseKey!, {
    global: {
      fetch: noStoreFetch,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          const persist =
            options?.authPersist ??
            readAuthPersistEnabled(
              cookieStore.get(AUTH_PERSIST_FLAG_COOKIE)?.value,
            );
          const adjusted = applyAuthCookiePersistence(cookiesToSet, persist);
          adjusted.forEach(({ name, value, options: cookieOptions }) =>
            cookieStore.set(name, value, cookieOptions),
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing user sessions.
        }
      },
    },
  });
};
