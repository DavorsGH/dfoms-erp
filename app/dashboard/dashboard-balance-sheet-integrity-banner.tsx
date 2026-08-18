"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { formatGHS } from "./finance/income-register-utils";
import type { TenantBalanceSheetIntegrityStatus } from "@/utils/tenant-balance-sheet-integrity-status-core";

/** Client cooldown after a live check — pairs with server rate limit. */
const CHECK_NOW_COOLDOWN_MS = 5000;

type DashboardBalanceSheetIntegrityBannerProps = {
  initialStatus: TenantBalanceSheetIntegrityStatus;
};

function buildBalanceSheetHref(status: TenantBalanceSheetIntegrityStatus): string {
  const params = new URLSearchParams();
  if (status.worstMonthIndex !== null) {
    params.set("focusMonth", String(status.worstMonthIndex));
  }
  if (status.fiscalYear !== null) {
    params.set("year", String(status.fiscalYear));
  }
  const query = params.toString();
  return query
    ? `/dashboard/finance/balance-sheet?${query}`
    : "/dashboard/finance/balance-sheet";
}

export default function DashboardBalanceSheetIntegrityBanner({
  initialStatus,
}: DashboardBalanceSheetIntegrityBannerProps) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckNow = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (loading || cooldown) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/dashboard/balance-sheet-integrity-status", {
          method: "POST",
        });
        const body = (await response.json().catch(() => null)) as
          | TenantBalanceSheetIntegrityStatus
          | { error?: string }
          | null;

        if (!response.ok) {
          setError(
            body && "error" in body && body.error
              ? body.error
              : "Balance sheet check failed",
          );
          return;
        }

        if (!body || "error" in body || !("imbalancedMonthCount" in body)) {
          setError("Balance sheet check failed");
          return;
        }

        setStatus(body as TenantBalanceSheetIntegrityStatus);
      } catch {
        setError("Balance sheet check failed");
      } finally {
        setLoading(false);
        setCooldown(true);
        window.setTimeout(() => setCooldown(false), CHECK_NOW_COOLDOWN_MS);
      }
    },
    [cooldown, loading],
  );

  if (status.imbalancedMonthCount <= 0) {
    return null;
  }

  const monthCountLabel =
    status.imbalancedMonthCount === 1
      ? "1 month"
      : `${status.imbalancedMonthCount} months`;
  const worstMonthSuffix = status.worstMonthLabel
    ? `, ${status.worstMonthLabel}`
    : "";
  const reviewHref = buildBalanceSheetHref(status);
  const checkDisabled = loading || cooldown;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Balance Sheet check:</span>{" "}
          {monthCountLabel} currently out of balance (worst:{" "}
          {formatGHS(status.worstDiff)}
          {worstMonthSuffix}).
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={handleCheckNow}
            disabled={checkDisabled}
            aria-busy={loading}
            className="rounded border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-950 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Checking…" : "Check now"}
          </button>
          <Link
            href={reviewHref}
            className="text-xs font-semibold text-amber-950 underline-offset-2 hover:underline"
          >
            Review →
          </Link>
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      ) : status.isStale ? (
        <p className="mt-2 text-xs text-amber-800/90">
          Last nightly check was more than 24 hours ago — figures may have changed
          since then.
        </p>
      ) : status.isLiveCheck ? (
        <p className="mt-2 text-xs text-amber-800/90">Checked just now.</p>
      ) : null}
    </div>
  );
}
