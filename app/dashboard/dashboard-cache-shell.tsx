"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Dashboard from "@/app/dashboard/dashboard";
import type { DashboardViewModel } from "@/app/dashboard/dashboard-utils";
import type { DashboardVisibility } from "@/utils/rbac-access";
import CacheStaleIndicator from "@/components/cache-stale-indicator";
import OfflineBanner from "@/components/offline-banner";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  getCachedDashboardSummary,
  setCachedDashboardSummary,
} from "@/lib/client-cache/dashboard-summary-cache";
import type { ClientCacheSession } from "@/lib/client-cache/keys";

type DashboardCacheShellProps = {
  session: ClientCacheSession;
  initialData: DashboardViewModel;
  initialFetchError: string | null;
  initialCachedAt: string;
  visibility: DashboardVisibility;
};

type SummaryApiResponse = {
  viewModel: DashboardViewModel;
  fetchError: string | null;
  cachedAt: string;
  tenantId: string;
  authUid: string;
};

export default function DashboardCacheShell({
  session,
  initialData,
  initialFetchError,
  initialCachedAt,
  visibility,
}: DashboardCacheShellProps) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [data, setData] = useState(initialData);
  const [fetchError, setFetchError] = useState(initialFetchError);
  const [cachedAt, setCachedAt] = useState(initialCachedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [servingFromCache, setServingFromCache] = useState(false);

  useEffect(() => {
    void setCachedDashboardSummary(session, {
      viewModel: initialData,
      fetchError: initialFetchError,
    }).then(setCachedAt);
  }, [initialData, initialFetchError, session]);

  useEffect(() => {
    if (isOnline) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const cached = await getCachedDashboardSummary(session);
      if (cancelled || !cached) {
        return;
      }
      setData(cached.payload.viewModel);
      setFetchError(cached.payload.fetchError);
      setCachedAt(cached.cachedAt);
      setServingFromCache(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOnline, session]);

  const refreshFromNetwork = useCallback(async () => {
    if (!isOnline) {
      return;
    }

    setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard/summary", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Unable to refresh dashboard summary.");
      }

      const payload = (await response.json()) as SummaryApiResponse;
      if (
        payload.tenantId !== session.tenantId ||
        payload.authUid !== session.authUid
      ) {
        throw new Error("Dashboard summary tenant mismatch.");
      }

      setData(payload.viewModel);
      setFetchError(payload.fetchError);
      setCachedAt(payload.cachedAt);
      setServingFromCache(false);
      await setCachedDashboardSummary(session, {
        viewModel: payload.viewModel,
        fetchError: payload.fetchError,
      });
    } catch (error) {
      setFetchError(
        error instanceof Error ? error.message : "Dashboard refresh failed.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [isOnline, session]);

  return (
    <div className="space-y-3">
      <OfflineBanner show={!isOnline && servingFromCache} />
      <div className="flex justify-end">
        <CacheStaleIndicator
          cachedAt={cachedAt}
          onRefresh={() => {
            if (isOnline) {
              void refreshFromNetwork();
              return;
            }
            router.refresh();
          }}
          refreshing={refreshing}
        />
      </div>
      <Dashboard data={data} fetchError={fetchError} visibility={visibility} />
    </div>
  );
}
