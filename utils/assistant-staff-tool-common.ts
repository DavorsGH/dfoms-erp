import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { fetchDashboardPageData } from "@/app/dashboard/dashboard-page-data";
import {
  getCurrentCalendarMonth,
  type DashboardViewModel,
} from "@/app/dashboard/dashboard-utils";
import { buildOwnerDashboardViewModel } from "@/app/dashboard/owner-dashboard-view-model";
import {
  getActiveBusinessUnitId,
  getCurrentAuthUid,
  getCurrentUserAccount,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { createClient } from "@/utils/supabase/server";

export const STAFF_FINANCIAL_PERIODS = [
  "this_month",
  "last_month",
  "ytd",
] as const;

export type StaffFinancialPeriod = (typeof STAFF_FINANCIAL_PERIODS)[number];

export const LIST_LIMIT = 20;
export const TOP_CUSTOMERS_LIMIT = 10;
export const DEFAULT_UPCOMING_MONTHS = 3;
export const MAX_UPCOMING_MONTHS = 12;

export const NO_STAFF_ACCOUNT_MESSAGE =
  "I couldn't find your staff account or workspace.";

export const STAFF_DATA_UNAVAILABLE_MESSAGE =
  "I couldn't retrieve your workspace data right now. Please try again later.";

export type StaffSession = {
  tenantId: string;
  authUid: string;
  role: AppRole;
};

const STAFF_PORTAL_ROLES: readonly AppRole[] = [
  "super_admin",
  "finance",
  "hr",
  "director",
  "operations_manager",
  "supervisor",
  "employee",
  "sales_rep",
];

export function isStaffPortalRole(role: string | null): role is AppRole {
  return role !== null && STAFF_PORTAL_ROLES.includes(role as AppRole);
}

export async function requireStaffSession(): Promise<
  { session: StaffSession } | { error: string }
> {
  const account = await getCurrentUserAccount();
  const authUid = await getCurrentAuthUid();

  if (!account?.tenant_id || !authUid || !isStaffPortalRole(account.role)) {
    return { error: NO_STAFF_ACCOUNT_MESSAGE };
  }

  return {
    session: {
      tenantId: account.tenant_id,
      authUid,
      role: account.role,
    },
  };
}

export async function getStaffSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function createMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseFinancialPeriod(toolInput: unknown): StaffFinancialPeriod {
  if (!toolInput || typeof toolInput !== "object") {
    return "this_month";
  }

  const period = (toolInput as Record<string, unknown>).period;
  if (
    period === "this_month" ||
    period === "last_month" ||
    period === "ytd"
  ) {
    return period;
  }

  return "this_month";
}

export function parseUpcomingMonths(toolInput: unknown): number {
  if (!toolInput || typeof toolInput !== "object") {
    return DEFAULT_UPCOMING_MONTHS;
  }

  const months = (toolInput as Record<string, unknown>).upcomingMonths;
  if (typeof months !== "number" || !Number.isFinite(months)) {
    return DEFAULT_UPCOMING_MONTHS;
  }

  return Math.min(Math.max(Math.trunc(months), 1), MAX_UPCOMING_MONTHS);
}

export function resolveFinancialPeriodSelection(
  period: StaffFinancialPeriod,
  defaultMonthKey: string,
  referenceDate = new Date(),
): {
  monthKey: string;
  useYtd: boolean;
  periodLabel: string;
  year: number;
  month: number;
} {
  const { year, month } = getCurrentCalendarMonth(referenceDate);

  if (period === "ytd") {
    return {
      monthKey: defaultMonthKey,
      useYtd: true,
      periodLabel: "YTD",
      year,
      month,
    };
  }

  if (period === "this_month") {
    return {
      monthKey: createMonthKey(year, month),
      useYtd: false,
      periodLabel: "This month",
      year,
      month,
    };
  }

  const lastMonthDate = new Date(year, month - 2, 1);
  const lastYear = lastMonthDate.getFullYear();
  const lastMonth = lastMonthDate.getMonth() + 1;

  return {
    monthKey: createMonthKey(lastYear, lastMonth),
    useYtd: false,
    periodLabel: "Last month",
    year: lastYear,
    month: lastMonth,
  };
}

export function periodKeyForSelection(
  period: StaffFinancialPeriod,
  referenceDate = new Date(),
): { mode: "month" | "year"; key: string } {
  const { year, month } = getCurrentCalendarMonth(referenceDate);

  if (period === "ytd") {
    return { mode: "year", key: String(year) };
  }

  if (period === "this_month") {
    return { mode: "month", key: createMonthKey(year, month) };
  }

  const lastMonthDate = new Date(year, month - 2, 1);
  return {
    mode: "month",
    key: createMonthKey(
      lastMonthDate.getFullYear(),
      lastMonthDate.getMonth() + 1,
    ),
  };
}

export const loadStaffDashboardViewModel = cache(
  async (): Promise<
    | { viewModel: DashboardViewModel; fetchError: string | null }
    | { error: string }
  > => {
    const tenantId = await getCurrentUserTenantId();
    if (!tenantId) {
      return { error: NO_STAFF_ACCOUNT_MESSAGE };
    }

    try {
      const supabase = await getStaffSupabase();
      const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
        getActiveBusinessUnitId(),
        getViewAllBusinessUnits(),
      ]);
      const buScope = resolveBusinessUnitReadScope({
        viewAllBusinessUnits,
        activeBusinessUnitId,
      });
      const pageData = await fetchDashboardPageData(supabase, tenantId, {
        activeBusinessUnitId,
        viewAllBusinessUnits,
      });
      const viewModel = await buildOwnerDashboardViewModel(pageData, tenantId, {
        supabase,
        buScope,
      });

      return {
        viewModel,
        fetchError: pageData.fetchError,
      };
    } catch (error) {
      console.error("[assistant] staff dashboard load failed:", error);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }
  },
);

export function pickMonthSnapshot(
  viewModel: DashboardViewModel,
  monthKey: string,
) {
  return (
    viewModel.monthSnapshots[monthKey] ??
    viewModel.monthSnapshots[viewModel.defaultMonthKey]
  );
}
