"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReferenceLookupsPayload } from "@/lib/client-cache/types";
import {
  getCachedReferenceLookups,
  setCachedReferenceLookups,
} from "@/lib/client-cache/dashboard-summary-cache";
import { resolveClientCacheSession } from "@/lib/client-cache/session-context";
import { useOnlineStatus } from "@/hooks/use-online-status";

type ReferenceLookupsApiResponse = {
  tenantId: string;
  authUid: string;
  cachedAt: string;
  payload: ReferenceLookupsPayload;
};

export function useCachedReferenceLookups(options?: {
  enabled?: boolean;
}): {
  lookups: ReferenceLookupsPayload | null;
  cachedAt: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const enabled = options?.enabled ?? true;
  const isOnline = useOnlineStatus();
  const [lookups, setLookups] = useState<ReferenceLookupsPayload | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const session = await resolveClientCacheSession();
    if (!session) {
      setError("Unable to resolve cache session.");
      setLoading(false);
      return;
    }

    if (!isOnline) {
      const cached = await getCachedReferenceLookups(session);
      if (cached) {
        setLookups(cached.payload);
        setCachedAt(cached.cachedAt);
      } else {
        setError("Offline with no cached reference lookups.");
      }
      setLoading(false);
      return;
    }

    const cached = await getCachedReferenceLookups(session);
    if (cached) {
      setLookups(cached.payload);
      setCachedAt(cached.cachedAt);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/lookups/reference", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Unable to load reference lookups.");
      }
      const payload = (await response.json()) as ReferenceLookupsApiResponse;
      if (
        payload.tenantId !== session.tenantId ||
        payload.authUid !== session.authUid
      ) {
        throw new Error("Reference lookup tenant mismatch.");
      }
      setLookups(payload.payload);
      setCachedAt(payload.cachedAt);
      await setCachedReferenceLookups(session, payload.payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Reference lookup load failed.",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled, isOnline]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    lookups,
    cachedAt,
    loading,
    error,
    refresh: load,
  };
}
