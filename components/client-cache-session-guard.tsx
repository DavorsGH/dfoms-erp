"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/utils/supabase/client";
import { purgeAllClientCache } from "@/lib/client-cache/purge";

/**
 * Purges IndexedDB when auth uid or tenant_id changes (logout, tenant switch).
 */
export default function ClientCacheSessionGuard() {
  const lastSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function syncSession() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        if (lastSessionRef.current !== null) {
          await purgeAllClientCache();
          lastSessionRef.current = null;
        }
        return;
      }

      const { data: account } = await supabase
        .from("user_accounts")
        .select("tenant_id")
        .eq("auth_uid", user.id)
        .maybeSingle();

      const tenantId = account?.tenant_id ?? "";
      const sessionKey = `${tenantId}:${user.id}`;

      if (
        lastSessionRef.current !== null &&
        lastSessionRef.current !== sessionKey
      ) {
        await purgeAllClientCache();
      }

      lastSessionRef.current = sessionKey;
    }

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncSession();
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
