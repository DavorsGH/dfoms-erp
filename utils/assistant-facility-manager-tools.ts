import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { formatMaintenanceStatus } from "@/app/dashboard/real-estate/maintenance-utils";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getFacilityManagerSession,
  type FacilityManagerPortalSession,
} from "@/utils/facility-portal-auth";
import {
  fetchFacilityAssignedProperties,
  fetchFacilityMaintenanceRequests,
  fetchFacilityManagerCollections,
  fetchFacilityServiceRecords,
} from "@/utils/facility-portal-data";

export const GET_MY_ASSIGNED_PROPERTIES_TOOL_NAME = "get_my_assigned_properties";
export const GET_MY_CAPABILITIES_TOOL_NAME = "get_my_capabilities";
export const GET_MY_OPEN_MAINTENANCE_REQUESTS_TOOL_NAME =
  "get_my_open_maintenance_requests";
export const GET_MY_PENDING_COLLECTIONS_TOOL_NAME = "get_my_pending_collections";
export const GET_MY_SERVICE_LOG_SUMMARY_TOOL_NAME = "get_my_service_log_summary";

const LIST_LIMIT = 20;

export const FACILITY_MANAGER_ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: GET_MY_ASSIGNED_PROPERTIES_TOOL_NAME,
    description:
      "List properties assigned to the signed-in Facility Manager. Call when the user asks which properties they manage or are assigned to. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_MY_CAPABILITIES_TOOL_NAME,
    description:
      "Return which Facility Manager capabilities the landlord enabled (maintenance, complaints, inspections, services, collect rent, collect charges). Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_MY_OPEN_MAINTENANCE_REQUESTS_TOOL_NAME,
    description:
      "List open (not completed or rejected) maintenance/repair requests on the Facility Manager's assigned properties, capped at 20. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_MY_PENDING_COLLECTIONS_TOOL_NAME,
    description:
      "List this Facility Manager's rent/charge collections still pending landlord confirmation, capped at 20. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_MY_SERVICE_LOG_SUMMARY_TOOL_NAME,
    description:
      "Summarize recent cleaning/gardening service logs on assigned properties (recent rows + total cost), capped at 20. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

const NO_FM_ACCOUNT_MESSAGE =
  "I couldn't find your Facility Manager account.";

const FM_DATA_UNAVAILABLE_MESSAGE =
  "I couldn't retrieve your Facility Manager data right now. Please try again later.";

async function requireFacilitySession(): Promise<
  | { session: FacilityManagerPortalSession }
  | { error: string }
> {
  const session = await getFacilityManagerSession();
  if (!session) {
    return { error: NO_FM_ACCOUNT_MESSAGE };
  }
  return { session };
}

async function getMyAssignedProperties(): Promise<unknown> {
  const auth = await requireFacilitySession();
  if ("error" in auth) {
    return auth;
  }

  try {
    const admin = createAdminClient();
    const { properties, error } = await fetchFacilityAssignedProperties(
      admin,
      auth.session,
    );
    if (error) {
      console.error("[assistant] get_my_assigned_properties failed:", error);
      return { error: FM_DATA_UNAVAILABLE_MESSAGE };
    }

    return {
      propertyCount: properties.length,
      properties: properties.map((p) => ({
        propertyId: p.propertyId,
        name: p.name,
      })),
    };
  } catch (error) {
    console.error("[assistant] get_my_assigned_properties threw:", error);
    return { error: FM_DATA_UNAVAILABLE_MESSAGE };
  }
}

async function getMyCapabilities(): Promise<unknown> {
  const auth = await requireFacilitySession();
  if ("error" in auth) {
    return auth;
  }

  const s = auth.session;
  return {
    canManageMaintenance: s.canManageMaintenance,
    canManageComplaints: s.canManageComplaints,
    canManageInspections: s.canManageInspections,
    canLogServices: s.canLogServices,
    canCollectRent: s.canCollectRent,
    canCollectCharges: s.canCollectCharges,
  };
}

async function getMyOpenMaintenanceRequests(): Promise<unknown> {
  const auth = await requireFacilitySession();
  if ("error" in auth) {
    return auth;
  }

  if (!auth.session.canManageMaintenance) {
    return {
      error:
        "Maintenance is not enabled for your Facility Manager account. Ask your landlord if you need this capability.",
    };
  }

  try {
    const admin = createAdminClient();
    const { rows, error } = await fetchFacilityMaintenanceRequests(
      admin,
      auth.session,
    );
    if (error) {
      console.error(
        "[assistant] get_my_open_maintenance_requests failed:",
        error,
      );
      return { error: FM_DATA_UNAVAILABLE_MESSAGE };
    }

    const open = rows
      .filter((row) => row.status !== "completed" && row.status !== "rejected")
      .slice(0, LIST_LIMIT)
      .map((row) => ({
        requestId: row.requestId,
        unitLabel: row.unitLabel,
        lesseeName: row.lesseeName,
        status: row.status,
        statusLabel: formatMaintenanceStatus(row.status),
        description: row.description,
        dateReported: row.dateReported,
      }));

    return {
      openCount: open.length,
      requests: open,
    };
  } catch (error) {
    console.error(
      "[assistant] get_my_open_maintenance_requests threw:",
      error,
    );
    return { error: FM_DATA_UNAVAILABLE_MESSAGE };
  }
}

async function getMyPendingCollections(): Promise<unknown> {
  const auth = await requireFacilitySession();
  if ("error" in auth) {
    return auth;
  }

  if (!auth.session.canCollectRent && !auth.session.canCollectCharges) {
    return {
      error:
        "Collecting rent or charges is not enabled for your Facility Manager account.",
      pendingCount: 0,
      collections: [],
    };
  }

  try {
    const admin = createAdminClient();
    const { rows, error } = await fetchFacilityManagerCollections(
      admin,
      auth.session,
    );
    if (error) {
      console.error("[assistant] get_my_pending_collections failed:", error);
      return { error: FM_DATA_UNAVAILABLE_MESSAGE };
    }

    const pending = rows
      .filter((row) => row.status === "pending_landlord_confirmation")
      .slice(0, LIST_LIMIT)
      .map((row) => ({
        collectionId: row.collectionId,
        propertyName: row.propertyName,
        lesseeName: row.lesseeName,
        unitLabel: row.unitLabel,
        amountGhs: row.amountGhs,
        paymentMethodLabel: row.paymentMethodLabel,
        collectedAt: row.collectedAt,
        status: row.status,
        statusLabel: row.statusLabel,
      }));

    return {
      pendingCount: pending.length,
      collections: pending,
    };
  } catch (error) {
    console.error("[assistant] get_my_pending_collections threw:", error);
    return { error: FM_DATA_UNAVAILABLE_MESSAGE };
  }
}

async function getMyServiceLogSummary(): Promise<unknown> {
  const auth = await requireFacilitySession();
  if ("error" in auth) {
    return auth;
  }

  if (!auth.session.canLogServices) {
    return {
      error:
        "Service logging is not enabled for your Facility Manager account.",
    };
  }

  try {
    const admin = createAdminClient();
    const { rows, totalCostGhs, error } = await fetchFacilityServiceRecords(
      admin,
      auth.session,
    );
    if (error) {
      console.error("[assistant] get_my_service_log_summary failed:", error);
      return { error: FM_DATA_UNAVAILABLE_MESSAGE };
    }

    const recent = rows.slice(0, LIST_LIMIT).map((row) => ({
      recordId: row.recordId,
      propertyName: row.propertyName,
      unitLabel: row.unitLabel,
      serviceType: row.serviceType,
      serviceDate: row.serviceDate,
      costGhs: row.costGhs,
    }));

    return {
      recentCount: recent.length,
      totalCostGhs,
      recentServices: recent,
    };
  } catch (error) {
    console.error("[assistant] get_my_service_log_summary threw:", error);
    return { error: FM_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function executeFacilityManagerAssistantTool(
  toolName: string,
  _toolInput?: unknown,
): Promise<unknown> {
  switch (toolName) {
    case GET_MY_ASSIGNED_PROPERTIES_TOOL_NAME:
      return getMyAssignedProperties();
    case GET_MY_CAPABILITIES_TOOL_NAME:
      return getMyCapabilities();
    case GET_MY_OPEN_MAINTENANCE_REQUESTS_TOOL_NAME:
      return getMyOpenMaintenanceRequests();
    case GET_MY_PENDING_COLLECTIONS_TOOL_NAME:
      return getMyPendingCollections();
    case GET_MY_SERVICE_LOG_SUMMARY_TOOL_NAME:
      return getMyServiceLogSummary();
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

export function facilityManagerAccountToolsSystemPromptAddition(): string {
  return `Account tools (facility manager only — call before answering, never guess):
- get_my_assigned_properties: properties the landlord assigned to you
- get_my_capabilities: which tasks you are allowed to do (maintenance, complaints, inspections, services, collect rent/charges)
- get_my_open_maintenance_requests: open repair requests on your assigned properties
- get_my_pending_collections: cash/MoMo collections waiting for landlord confirmation
- get_my_service_log_summary: recent service logs and total cost on assigned properties

Only share values returned by these tools. If a tool reports an error, explain it honestly. You cannot see landlord financials, payouts, bank details, leases, or account settings — do not invent those.`;
}
