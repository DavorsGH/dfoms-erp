"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CacheStaleIndicator from "@/components/cache-stale-indicator";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  getCachedCustomerBalances,
  setCachedCustomerBalances,
} from "@/lib/client-cache/customer-balances-cache";
import type { ClientCacheSession } from "@/lib/client-cache/keys";
import {
  finishedProductsToStockCachePayload,
  stockCachePayloadToFinishedProducts,
} from "@/lib/client-cache/pos-cache-mappers";
import {
  getCachedStockLevels,
  setCachedStockLevels,
} from "@/lib/client-cache/stock-levels-cache";
import type {
  CustomerBalancesCachePayload,
} from "@/lib/client-cache/types";
import type { FinishedProductRecord } from "@/app/dashboard/inventory/finished-products-utils";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";
import type { PosCartLine } from "@/app/dashboard/pos/pos-utils";
import PosCheckout from "@/app/dashboard/pos/pos-checkout";

type PosCacheShellProps = {
  session: ClientCacheSession;
  showTitle?: boolean;
  initialClients: ClientEntry[];
  initialProducts: FinishedProductRecord[];
  initialCustomerBalances: CustomerBalancesCachePayload;
  initialEmployees: HrEmployee[];
  defaultSalesRepId?: string;
  initialPaymentMethods: string[];
  initialCartLines?: PosCartLine[];
  initialClientId?: string;
  initialNotes?: string;
  quoteConversionId?: string;
  quoteNumber?: string;
  fetchError: string | null;
  initialCachedAt: string;
  /** Create-only stamp for product sales; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

export default function PosCacheShell({
  session,
  showTitle = true,
  initialClients,
  initialProducts,
  initialCustomerBalances,
  initialEmployees,
  defaultSalesRepId = "",
  initialPaymentMethods,
  initialCartLines = [],
  initialClientId = "",
  initialNotes = "",
  quoteConversionId,
  quoteNumber,
  fetchError,
  initialCachedAt,
  activeBusinessUnitId = null,
}: PosCacheShellProps) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [products, setProducts] = useState(initialProducts);
  const [customerBalances, setCustomerBalances] = useState(
    initialCustomerBalances,
  );
  const [cachedAt, setCachedAt] = useState(initialCachedAt);
  const [usingCachedSnapshot, setUsingCachedSnapshot] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(fetchError);

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    void (async () => {
      const stockAt = await setCachedStockLevels(
        session,
        finishedProductsToStockCachePayload(initialProducts),
      );
      const balancesAt = await setCachedCustomerBalances(
        session,
        initialCustomerBalances,
      );
      setCachedAt(stockAt > balancesAt ? stockAt : balancesAt);
      setUsingCachedSnapshot(false);
    })();
  }, [initialProducts, initialCustomerBalances, isOnline, session]);

  useEffect(() => {
    if (isOnline) {
      setProducts(initialProducts);
      setCustomerBalances(initialCustomerBalances);
      setError(fetchError);
      setUsingCachedSnapshot(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const [stock, balances] = await Promise.all([
        getCachedStockLevels(session),
        getCachedCustomerBalances(session),
      ]);
      if (cancelled) {
        return;
      }

      if (stock) {
        setProducts(stockCachePayloadToFinishedProducts(stock.payload));
        setCachedAt(stock.cachedAt);
        setUsingCachedSnapshot(true);
        setError(null);
      } else {
        setError(
          "Stock levels are unavailable offline. Open POS while online once to cache them.",
        );
      }

      if (balances) {
        setCustomerBalances(balances.payload);
        setCachedAt((current) =>
          balances.cachedAt > current ? balances.cachedAt : current,
        );
        setUsingCachedSnapshot(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOnline, session, initialProducts, initialCustomerBalances, fetchError]);

  const refreshFromNetwork = useCallback(() => {
    if (!isOnline) {
      return;
    }
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 800);
  }, [isOnline, router]);

  const reloadStockFromCache = useCallback(async () => {
    const stock = await getCachedStockLevels(session);
    if (!stock) {
      return;
    }
    setProducts(stockCachePayloadToFinishedProducts(stock.payload));
    setCachedAt(stock.cachedAt);
    setUsingCachedSnapshot(true);
  }, [session]);

  const balancesByClientId = customerBalances.customers;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {usingCachedSnapshot || !isOnline ? (
          <p
            data-testid="pos-cached-snapshot-banner"
            className="text-xs text-amber-800"
          >
            Showing cached snapshot
            {!isOnline
              ? " (offline — cash sales can be queued; MoMo / Request Payment blocked)"
              : ""}
            .
          </p>
        ) : (
          <span />
        )}
        <CacheStaleIndicator
          cachedAt={cachedAt}
          onRefresh={() => {
            if (isOnline) {
              refreshFromNetwork();
              return;
            }
            // Avoid router.refresh() offline — it starts RSC fetches that hang
            // in DevTools and can remount POS mid-checkout.
            void reloadStockFromCache();
          }}
          refreshing={refreshing}
        />
      </div>
      <PosCheckout
        showTitle={showTitle}
        initialClients={initialClients}
        initialProducts={products}
        initialCustomerBalances={balancesByClientId}
        initialEmployees={initialEmployees}
        defaultSalesRepId={defaultSalesRepId}
        initialPaymentMethods={initialPaymentMethods}
        initialCartLines={initialCartLines}
        initialClientId={initialClientId}
        initialNotes={initialNotes}
        quoteConversionId={quoteConversionId}
        quoteNumber={quoteNumber}
        fetchError={error}
        activeBusinessUnitId={activeBusinessUnitId}
        onStockLevelsChanged={async (nextProducts) => {
          setProducts(nextProducts);
          if (!isOnline) {
            return;
          }
          const nextCachedAt = await setCachedStockLevels(
            session,
            finishedProductsToStockCachePayload(nextProducts),
          );
          setCachedAt(nextCachedAt);
        }}
        onStockCacheChanged={reloadStockFromCache}
      />
    </div>
  );
}
