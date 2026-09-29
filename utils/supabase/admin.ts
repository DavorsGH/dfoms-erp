import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseInstrumentedFetch } from "@/lib/supabase-http-perf";
import { noStoreFetch } from "@/utils/supabase/no-store-fetch";

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin credentials");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    global: {
      fetch: getSupabaseInstrumentedFetch(noStoreFetch),
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
