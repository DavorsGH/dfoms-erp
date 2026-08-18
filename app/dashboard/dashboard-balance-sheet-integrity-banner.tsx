import Link from "next/link";
import { formatGHS } from "./finance/income-register-utils";
import type { TenantBalanceSheetIntegrityStatus } from "@/utils/tenant-balance-sheet-integrity-status-core";

type DashboardBalanceSheetIntegrityBannerProps = {
  status: TenantBalanceSheetIntegrityStatus;
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
  status,
}: DashboardBalanceSheetIntegrityBannerProps) {
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

  return (
    <Link
      href={buildBalanceSheetHref(status)}
      className="block rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 transition-colors hover:border-amber-400 hover:bg-amber-100"
    >
      <span className="font-semibold">Balance Sheet check:</span>{" "}
      {monthCountLabel} currently out of balance (worst:{" "}
      {formatGHS(status.worstDiff)}
      {worstMonthSuffix}). Review →
      {status.isStale ? (
        <span className="mt-1 block text-xs text-amber-800/90">
          Last nightly check was more than 24 hours ago — figures may have changed
          since then.
        </span>
      ) : null}
    </Link>
  );
}
