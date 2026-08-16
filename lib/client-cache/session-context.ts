"use client";

import { createClient } from "@/utils/supabase/client";
import type { ClientCacheSession } from "@/lib/client-cache/keys";

export async function resolveClientCacheSession(): Promise<ClientCacheSession | null> {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    return null;
  }

  const { data: account, error: accountError } = await supabase
    .from("user_accounts")
    .select("tenant_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (accountError || !account?.tenant_id) {
    return null;
  }

  return {
    tenantId: account.tenant_id,
    authUid: user.id,
  };
}
