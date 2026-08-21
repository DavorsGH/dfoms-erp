import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { isActiveLeaseStatus } from "@/app/dashboard/real-estate/rent-ledger-utils";
import {
  fetchLandlordPortalDashboardData,
  fetchLandlordPortalLeasesBrowse,
  fetchLandlordPortalOverviewMetrics,
  fetchLandlordPortalProperties,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
  type LandlordPortalSession,
} from "@/utils/landlord-portal-auth";

export const GET_PROPERTIES_TOOL_NAME = "get_properties";
export const GET_PAYOUT_SUMMARY_TOOL_NAME = "get_payout_summary";
export const GET_TENANT_OCCUPANCY_TOOL_NAME = "get_tenant_occupancy";
export const GET_RENT_COLLECTION_STATUS_TOOL_NAME = "get_rent_collection_status";
export const GET_LEASE_EXPIRATIONS_TOOL_NAME = "get_lease_expirations";

const LIST_LIMIT = 20;
const DEFAULT_UPCOMING_MONTHS = 3;
const MAX_UPCOMING_MONTHS = 12;

export const LANDLORD_ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: GET_PROPERTIES_TOOL_NAME,
    description:
      "List the signed-in landlord's properties with unit counts and occupancy. Call when the user asks about their properties, units, or portfolio overview. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_PAYOUT_SUMMARY_TOOL_NAME,
    description:
      "Look up the landlord's payout history and escrow balance (Davors-managed landlords). Call when the user asks about payouts, remittances, or money received from rent. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_TENANT_OCCUPANCY_TOOL_NAME,
    description:
      "Look up occupancy and vacancy across the landlord's properties — total/occupied/vacant units and per-property breakdown. Call when the user asks about occupancy, vacancy, or how full their properties are. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_RENT_COLLECTION_STATUS_TOOL_NAME,
    description:
      "Look up rent collection status: amounts collected this month, total outstanding, arrears aging buckets, and tenants with overdue balances. Call when the user asks who is current vs overdue, rent collection, or arrears. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_LEASE_EXPIRATIONS_TOOL_NAME,
    description:
      "List active leases expiring within a upcoming time window across the landlord's properties. Call when the user asks about leases ending soon or upcoming expirations. Optional upcomingMonths (default 3, max 12).",
    input_schema: {
      type: "object",
      properties: {
        upcomingMonths: {
          type: "integer",
          description:
            "How many months ahead to search for lease end dates (default 3, maximum 12).",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
];

export type LandlordToolError = {
  error: string;
};

const NO_LANDLORD_ACCOUNT_MESSAGE = "I couldn't find your landlord account.";

const LANDLORD_PENDING_APPROVAL_MESSAGE =
  "Your landlord account is not approved for portal access yet.";

const LANDLORD_DATA_UNAVAILABLE_MESSAGE =
  "I couldn't retrieve your account data right now. Please try again later.";

async function requireLandlordSession(): Promise<
  | { session: LandlordPortalSession }
  | { error: string }
> {
  const session = await getLandlordPortalSession();
  if (!session) {
    return { error: NO_LANDLORD_ACCOUNT_MESSAGE };
  }
  if (!landlordPortalHasDataAccess(session)) {
    return { error: LANDLORD_PENDING_APPROVAL_MESSAGE };
  }
  return { session };
}

function parseUpcomingMonths(toolInput: unknown): number {
  if (!toolInput || typeof toolInput !== "object") {
    return DEFAULT_UPCOMING_MONTHS;
  }

  const months = (toolInput as Record<string, unknown>).upcomingMonths;
  if (typeof months !== "number" || !Number.isFinite(months)) {
    return DEFAULT_UPCOMING_MONTHS;
  }

  return Math.min(
    MAX_UPCOMING_MONTHS,
    Math.max(1, Math.round(months)),
  );
}

function addMonthsIso(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

export async function getLandlordProperties(): Promise<
  | {
      properties: Array<{
        name: string;
        city: string | null;
        region: string | null;
        propertyType: string | null;
        unitCount: number;
        occupiedUnits: number;
        vacantUnits: number;
      }>;
    }
  | LandlordToolError
> {
  try {
    const sessionResult = await requireLandlordSession();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const { rows, error } = await fetchLandlordPortalProperties(
      sessionResult.session,
    );
    if (error) {
      console.error("[assistant] get_properties failed:", error);
      return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
    }

    return {
      properties: rows.map((row) => ({
        name: row.name,
        city: row.city,
        region: row.region,
        propertyType: row.propertyType,
        unitCount: row.unitCount,
        occupiedUnits: row.occupiedCount,
        vacantUnits: Math.max(0, row.unitCount - row.occupiedCount),
      })),
    };
  } catch (error) {
    console.error("[assistant] get_properties threw:", error);
    return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getLandlordPayoutSummary(): Promise<
  | {
      currency: "GHS";
      escrowBalanceGhs: number | null;
      payouts: Array<{
        periodStart: string;
        periodEnd: string;
        netAmountGhs: number;
        status: string;
        remittanceDate: string | null;
      }>;
    }
  | LandlordToolError
> {
  try {
    const sessionResult = await requireLandlordSession();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const { data, error } = await fetchLandlordPortalDashboardData(
      sessionResult.session,
    );
    if (error) {
      console.error("[assistant] get_payout_summary failed:", error);
      return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
    }

    return {
      currency: "GHS",
      escrowBalanceGhs: data?.escrowBalanceGhs ?? null,
      payouts: (data?.payouts ?? []).map((row) => ({
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        netAmountGhs: row.netAmountGhs,
        status: row.remittanceStatusLabel,
        remittanceDate: row.remittanceDate,
      })),
    };
  } catch (error) {
    console.error("[assistant] get_payout_summary threw:", error);
    return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getLandlordTenantOccupancy(): Promise<
  | {
      totalUnits: number;
      occupiedUnits: number;
      vacantUnits: number;
      occupancyRatePct: number;
      properties: Array<{
        name: string;
        unitCount: number;
        occupiedUnits: number;
        vacantUnits: number;
      }>;
    }
  | LandlordToolError
> {
  try {
    const sessionResult = await requireLandlordSession();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const [overview, propertiesResult] = await Promise.all([
      fetchLandlordPortalOverviewMetrics(sessionResult.session),
      fetchLandlordPortalProperties(sessionResult.session),
    ]);

    if (overview.error) {
      console.error("[assistant] get_tenant_occupancy failed:", overview.error);
      return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
    }
    if (propertiesResult.error) {
      console.error(
        "[assistant] get_tenant_occupancy properties failed:",
        propertiesResult.error,
      );
      return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
    }

    return {
      totalUnits: overview.data?.totalUnits ?? 0,
      occupiedUnits: overview.data?.occupiedUnits ?? 0,
      vacantUnits: overview.data?.vacantUnits ?? 0,
      occupancyRatePct: overview.data?.occupancyRatePct ?? 0,
      properties: propertiesResult.rows.map((row) => ({
        name: row.name,
        unitCount: row.unitCount,
        occupiedUnits: row.occupiedCount,
        vacantUnits: Math.max(0, row.unitCount - row.occupiedCount),
      })),
    };
  } catch (error) {
    console.error("[assistant] get_tenant_occupancy threw:", error);
    return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getLandlordRentCollectionStatus(): Promise<
  | {
      currency: "GHS";
      collectedThisMonthGhs: number;
      totalOutstandingGhs: number;
      paidEntryCount: number;
      unpaidEntryCount: number;
      arrearsBuckets: {
        days0to30: number;
        days31to60: number;
        days61Plus: number;
      };
      overdueTenants: Array<{
        tenantName: string;
        unit: string;
        status: string;
        outstandingGhs: number;
        periodEnd: string;
      }>;
    }
  | LandlordToolError
> {
  try {
    const sessionResult = await requireLandlordSession();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const [overview, dashboard] = await Promise.all([
      fetchLandlordPortalOverviewMetrics(sessionResult.session),
      fetchLandlordPortalDashboardData(sessionResult.session),
    ]);

    if (overview.error) {
      console.error(
        "[assistant] get_rent_collection_status failed:",
        overview.error,
      );
      return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
    }
    if (dashboard.error) {
      console.error(
        "[assistant] get_rent_collection_status dashboard failed:",
        dashboard.error,
      );
      return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
    }

    const overdueTenants = (dashboard.data?.rent.recent ?? [])
      .filter((row) => row.outstandingGhs > 0)
      .slice(0, LIST_LIMIT)
      .map((row) => ({
        tenantName: row.lesseeName,
        unit: row.unitLabel,
        status: row.statusLabel,
        outstandingGhs: row.outstandingGhs,
        periodEnd: row.periodEnd,
      }));

    return {
      currency: "GHS",
      collectedThisMonthGhs: overview.data?.rentCollectedThisMonthGhs ?? 0,
      totalOutstandingGhs: overview.data?.outstandingBalanceGhs ?? 0,
      paidEntryCount: dashboard.data?.rent.paidCount ?? 0,
      unpaidEntryCount: dashboard.data?.rent.unpaidCount ?? 0,
      arrearsBuckets: overview.data?.arrearsBuckets ?? {
        days0to30: 0,
        days31to60: 0,
        days61Plus: 0,
      },
      overdueTenants,
    };
  } catch (error) {
    console.error("[assistant] get_rent_collection_status threw:", error);
    return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getLandlordLeaseExpirations(
  toolInput: unknown,
): Promise<
  | {
      upcomingMonths: number;
      expirations: Array<{
        property: string;
        unit: string;
        tenantName: string;
        endDate: string;
        monthlyRentGhs: number;
      }>;
    }
  | LandlordToolError
> {
  try {
    const sessionResult = await requireLandlordSession();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const upcomingMonths = parseUpcomingMonths(toolInput);
    const { rows, error } = await fetchLandlordPortalLeasesBrowse(
      sessionResult.session,
    );
    if (error) {
      console.error("[assistant] get_lease_expirations failed:", error);
      return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const horizonIso = addMonthsIso(todayIso, upcomingMonths);

    const expirations = rows
      .filter(
        (row) =>
          isActiveLeaseStatus(row.status) &&
          row.endDate >= todayIso &&
          row.endDate <= horizonIso,
      )
      .sort((a, b) => a.endDate.localeCompare(b.endDate))
      .slice(0, LIST_LIMIT)
      .map((row) => ({
        property: row.propertyName,
        unit: row.unitNumber,
        tenantName: row.lesseeName,
        endDate: row.endDate,
        monthlyRentGhs: row.rentAmountGhs,
      }));

    return { upcomingMonths, expirations };
  } catch (error) {
    console.error("[assistant] get_lease_expirations threw:", error);
    return { error: LANDLORD_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function executeLandlordAssistantTool(
  toolName: string,
  toolInput?: unknown,
): Promise<unknown> {
  if (toolName === GET_PROPERTIES_TOOL_NAME) {
    return getLandlordProperties();
  }

  if (toolName === GET_PAYOUT_SUMMARY_TOOL_NAME) {
    return getLandlordPayoutSummary();
  }

  if (toolName === GET_TENANT_OCCUPANCY_TOOL_NAME) {
    return getLandlordTenantOccupancy();
  }

  if (toolName === GET_RENT_COLLECTION_STATUS_TOOL_NAME) {
    return getLandlordRentCollectionStatus();
  }

  if (toolName === GET_LEASE_EXPIRATIONS_TOOL_NAME) {
    return getLandlordLeaseExpirations(toolInput);
  }

  return { error: `Unknown tool: ${toolName}` };
}

export function landlordAccountToolsSystemPromptAddition(): string {
  return `Account tools (landlord only — call before answering, never guess):
- get_properties: property list with unit counts and occupancy
- get_payout_summary: payout history and escrow balance (Davors-managed landlords)
- get_tenant_occupancy: portfolio-wide and per-property occupancy/vacancy
- get_rent_collection_status: rent collected this month, outstanding totals, arrears buckets, tenants with overdue balances
- get_lease_expirations: active leases ending within upcomingMonths (default 3, max 12)

Only share values returned by these tools. If a tool reports an error, explain it honestly. For other account-specific data not covered by your tools, explain that capability is coming soon.`;
}
