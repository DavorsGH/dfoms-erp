"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/utils/supabase/client";
import type { ClientCacheSession } from "@/lib/client-cache/keys";
import {
  rememberClientCacheSession,
  resolveClientCacheSession,
} from "@/lib/client-cache/session-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { drainWriteQueue } from "@/lib/offline-write-queue/drain";
import { restoreOptimisticStockDecrement } from "@/lib/offline-write-queue/pos-optimistic-stock";
import {
  countOpenWriteQueueItems,
  deleteWriteQueueItem,
  getWriteQueueItem,
  listWriteQueueForSession,
} from "@/lib/offline-write-queue/store";
import type {
  OfflineWriteQueueItem,
  PosCashSaleQueuePayload,
} from "@/lib/offline-write-queue/types";

type WriteQueueContextValue = {
  session: ClientCacheSession | null;
  items: OfflineWriteQueueItem[];
  pendingCount: number;
  failedCount: number;
  syncingCount: number;
  conflictCount: number;
  openCount: number;
  draining: boolean;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
  discardItem: (id: string) => Promise<void>;
  retryItem: (id: string) => Promise<void>;
};

const WriteQueueContext = createContext<WriteQueueContextValue | null>(null);

export function WriteQueueProvider({
  children,
  tenantId,
  authUid,
}: {
  children: ReactNode;
  tenantId?: string | null;
  authUid?: string | null;
}) {
  const isOnline = useOnlineStatus();
  const [session, setSession] = useState<ClientCacheSession | null>(() => {
    if (tenantId?.trim() && authUid?.trim()) {
      return { tenantId, authUid };
    }
    return null;
  });
  const [items, setItems] = useState<OfflineWriteQueueItem[]>([]);
  const [counts, setCounts] = useState({
    pending: 0,
    failed: 0,
    syncing: 0,
    conflict: 0,
  });
  const [draining, setDraining] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (tenantId?.trim() && authUid?.trim()) {
      const next = { tenantId, authUid };
      rememberClientCacheSession(next);
      setSession(next);
      return;
    }
    void resolveClientCacheSession().then((resolved) => {
      if (resolved) setSession(resolved);
    });
  }, [tenantId, authUid]);

  const refresh = useCallback(async () => {
    const active =
      session ??
      (tenantId?.trim() && authUid?.trim()
        ? { tenantId, authUid }
        : await resolveClientCacheSession());
    if (!active) {
      setItems([]);
      setCounts({ pending: 0, failed: 0, syncing: 0, conflict: 0 });
      return;
    }
    setSession(active);
    const [listed, open] = await Promise.all([
      listWriteQueueForSession(active),
      countOpenWriteQueueItems(active),
    ]);
    setItems(listed);
    setCounts(open);
  }, [session, tenantId, authUid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const syncNow = useCallback(async () => {
    const active =
      session ??
      (tenantId?.trim() && authUid?.trim()
        ? { tenantId, authUid }
        : await resolveClientCacheSession());
    if (!active || !navigator.onLine) {
      await refresh();
      return;
    }
    setDraining(true);
    try {
      const supabase = createClient();
      await drainWriteQueue(supabase, active);
    } finally {
      setDraining(false);
      await refresh();
    }
  }, [session, tenantId, authUid, refresh]);

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) {
      return;
    }
    wasOfflineRef.current = false;
    void syncNow();
  }, [isOnline, syncNow]);

  const discardItem = useCallback(
    async (id: string) => {
      const existing = await getWriteQueueItem(id);
      const active =
        session ??
        (tenantId?.trim() && authUid?.trim()
          ? { tenantId, authUid }
          : await resolveClientCacheSession());

      if (
        existing?.type === "pos_cash_sale" &&
        active &&
        (existing.status === "pending" ||
          existing.status === "failed" ||
          existing.status === "conflict")
      ) {
        const payload = existing.payload as PosCashSaleQueuePayload;
        await restoreOptimisticStockDecrement(
          active,
          payload.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
          })),
        );
      }

      // Local discard only — server offline_sale_conflicts rows are retained.
      await deleteWriteQueueItem(id);
      await refresh();
    },
    [refresh, session, tenantId, authUid],
  );

  const retryItem = useCallback(
    async (_id: string) => {
      await syncNow();
    },
    [syncNow],
  );

  const value = useMemo<WriteQueueContextValue>(
    () => ({
      session,
      items,
      pendingCount: counts.pending,
      failedCount: counts.failed,
      syncingCount: counts.syncing,
      conflictCount: counts.conflict,
      openCount:
        counts.pending + counts.failed + counts.syncing + counts.conflict,
      draining,
      refresh,
      syncNow,
      discardItem,
      retryItem,
    }),
    [
      session,
      items,
      counts,
      draining,
      refresh,
      syncNow,
      discardItem,
      retryItem,
    ],
  );

  return (
    <WriteQueueContext.Provider value={value}>
      {children}
    </WriteQueueContext.Provider>
  );
}

export function useWriteQueue(): WriteQueueContextValue {
  const ctx = useContext(WriteQueueContext);
  if (!ctx) {
    throw new Error("useWriteQueue must be used within WriteQueueProvider");
  }
  return ctx;
}

/** Safe for pages that may render outside the provider (returns nulls). */
export function useWriteQueueOptional(): WriteQueueContextValue | null {
  return useContext(WriteQueueContext);
}
