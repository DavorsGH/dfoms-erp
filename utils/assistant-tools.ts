import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import {
  formatLesseeComplaintStatus,
  type LesseeComplaintRaisedBy,
} from "@/app/dashboard/real-estate/complaints-utils";
import {
  formatMaintenanceLandlordApproval,
  formatMaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
import type { HandbookPersona } from "@/utils/assistant-handbook-retrieval";
import { fetchComplaintsForLessee } from "@/utils/complaint-management";
import {
  fetchPortalDashboardData,
  getPortalLesseeSession,
  type PortalLesseeSession,
} from "@/utils/lessee-portal-auth";
import { fetchMaintenanceRequestsForLessee } from "@/utils/maintenance-management";
import { createAdminClient } from "@/utils/supabase/admin";

export const GET_RENT_BALANCE_TOOL_NAME = "get_rent_balance";
export const GET_LEASE_SUMMARY_TOOL_NAME = "get_lease_summary";
export const GET_REPAIR_REQUESTS_TOOL_NAME = "get_repair_requests";
export const GET_COMPLAINTS_TOOL_NAME = "get_complaints";
export const GET_MY_ISSUES_TOOL_NAME = "get_my_issues";

const LIST_LIMIT = 20;

export const TENANT_ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: GET_RENT_BALANCE_TOOL_NAME,
    description:
      "Look up the current signed-in tenant's rent balance, total amount due (including any outstanding one-time charges), next due date, and lease status. Call this when the user asks about rent owed, balance, arrears, or payment due dates. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_LEASE_SUMMARY_TOOL_NAME,
    description:
      "Look up the current signed-in tenant's active lease summary: property name, unit number, monthly rent, lease status, start date, and end date. Call this when the user asks about their lease, unit, property, rent amount, or lease dates. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_REPAIR_REQUESTS_TOOL_NAME,
    description:
      "List the signed-in tenant's own repair/maintenance requests with status, description, and date submitted. Call when the user asks about repairs, maintenance, or fix requests they submitted. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_COMPLAINTS_TOOL_NAME,
    description:
      "List the signed-in tenant's complaints with status, subject/description, and date filed. Call when the user asks about complaints they or their landlord raised. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: GET_MY_ISSUES_TOOL_NAME,
    description:
      "List the signed-in tenant's repair requests and complaints together in one timeline (same combined view as the My Issues portal page). Call when the user asks broadly about all their open issues, problems, or what's pending — not when they ask specifically about only repairs or only complaints. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

export type RentBalanceToolSuccess = {
  balance: number;
  currency: "GHS";
  nextDueDate: string | null;
  leaseStatus: string;
};

export type RentBalanceToolError = {
  error: string;
};

export type RentBalanceToolResult = RentBalanceToolSuccess | RentBalanceToolError;

export type LeaseSummaryToolSuccess = {
  property: string;
  unit: string;
  monthlyRent: number;
  currency: "GHS";
  status: string;
  startDate: string;
  endDate: string;
};

export type LeaseSummaryToolError = {
  error: string;
};

export type LeaseSummaryToolResult =
  | LeaseSummaryToolSuccess
  | LeaseSummaryToolError;

export type RepairRequestItem = {
  description: string;
  status: string;
  dateSubmitted: string;
};

export type RepairRequestsToolSuccess = {
  requests: RepairRequestItem[];
};

export type ComplaintItem = {
  description: string;
  status: string;
  dateFiled: string;
};

export type ComplaintsToolSuccess = {
  complaints: ComplaintItem[];
};

export type MyIssueItem = {
  type: "repair" | "complaint";
  description: string;
  status: string;
  date: string;
};

export type MyIssuesToolSuccess = {
  issues: MyIssueItem[];
};

export type TenantListToolError = {
  error: string;
};

export type RepairRequestsToolResult =
  | RepairRequestsToolSuccess
  | TenantListToolError;

export type ComplaintsToolResult =
  | ComplaintsToolSuccess
  | TenantListToolError;

export type MyIssuesToolResult = MyIssuesToolSuccess | TenantListToolError;

const NO_ACTIVE_LEASE_MESSAGE =
  "I couldn't find an active lease for your account.";

const NO_TENANT_ACCOUNT_MESSAGE = "I couldn't find your tenant account.";

const TENANT_DATA_UNAVAILABLE_MESSAGE =
  "I couldn't retrieve your account data right now. Please try again later.";

async function requirePortalLesseeSession(): Promise<
  | { session: PortalLesseeSession }
  | { error: string }
> {
  const session = await getPortalLesseeSession();
  if (!session) {
    return { error: NO_TENANT_ACCOUNT_MESSAGE };
  }
  return { session };
}

function formatRepairStatusLabel(
  status: string,
  landlordApprovalStatus: string,
  tenantSelfFix: boolean,
): string {
  return [
    formatMaintenanceStatus(status),
    `Landlord ${formatMaintenanceLandlordApproval(landlordApprovalStatus)}`,
    tenantSelfFix ? "Self-fix" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatComplaintStatusLabel(
  status: string,
  raisedBy: LesseeComplaintRaisedBy,
  tenantAcknowledgedAt: string | null,
): string {
  return [
    formatLesseeComplaintStatus(status),
    raisedBy === "tenant" &&
    status === "resolved" &&
    !tenantAcknowledgedAt
      ? "Awaiting your acknowledgment"
      : tenantAcknowledgedAt
        ? "Acknowledged"
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Read-only rent balance for the authenticated lessee session.
 * Reuses the same dashboard loader as the tenant portal — no IDs from the AI.
 */
export async function getRentBalance(): Promise<RentBalanceToolResult> {
  try {
    const sessionResult = await requirePortalLesseeSession();
    if ("error" in sessionResult) {
      return { error: NO_ACTIVE_LEASE_MESSAGE };
    }

    const { data, error } = await fetchPortalDashboardData(sessionResult.session);
    if (error) {
      console.error("[assistant] get_rent_balance failed:", error);
      return {
        error:
          "I couldn't retrieve your rent balance right now. Please try again later.",
      };
    }

    if (!data) {
      return {
        error: NO_ACTIVE_LEASE_MESSAGE,
      };
    }

    const nextDueDate =
      data.unpaidRent?.periodEnd ?? data.rentPeriodEnd ?? null;

    return {
      balance: data.paymentTotalGhs,
      currency: "GHS",
      nextDueDate,
      leaseStatus: data.leaseStatus,
    };
  } catch (error) {
    console.error("[assistant] get_rent_balance threw:", error);
    return {
      error:
        "I couldn't retrieve your rent balance right now. Please try again later.",
    };
  }
}

/**
 * Read-only active lease summary for the authenticated lessee session.
 * Reuses fetchPortalDashboardData — same fields as /portal/dashboard Active lease card.
 */
export async function getLeaseSummary(): Promise<LeaseSummaryToolResult> {
  try {
    const sessionResult = await requirePortalLesseeSession();
    if ("error" in sessionResult) {
      return { error: NO_ACTIVE_LEASE_MESSAGE };
    }

    const { data, error } = await fetchPortalDashboardData(sessionResult.session);
    if (error) {
      console.error("[assistant] get_lease_summary failed:", error);
      return {
        error: TENANT_DATA_UNAVAILABLE_MESSAGE,
      };
    }

    if (!data) {
      return {
        error: NO_ACTIVE_LEASE_MESSAGE,
      };
    }

    return {
      property: data.propertyName,
      unit: data.unitNumber,
      monthlyRent: data.rentAmountGhs,
      currency: "GHS",
      status: data.leaseStatus,
      startDate: data.leaseStartDate,
      endDate: data.leaseEndDate,
    };
  } catch (error) {
    console.error("[assistant] get_lease_summary threw:", error);
    return {
      error: TENANT_DATA_UNAVAILABLE_MESSAGE,
    };
  }
}

/**
 * Read-only repair requests — same query/filter as /portal/repairs.
 */
export async function getRepairRequests(): Promise<RepairRequestsToolResult> {
  try {
    const sessionResult = await requirePortalLesseeSession();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const admin = createAdminClient();
    const { rows, fetchError } = await fetchMaintenanceRequestsForLessee(
      admin,
      sessionResult.session.tenantId,
      sessionResult.session.lesseeId,
    );

    if (fetchError) {
      console.error("[assistant] get_repair_requests failed:", fetchError);
      return { error: TENANT_DATA_UNAVAILABLE_MESSAGE };
    }

    const requests = rows
      .filter((row) => row.reportedBy === "tenant")
      .slice(0, LIST_LIMIT)
      .map((row) => ({
        description: row.description,
        status: formatRepairStatusLabel(
          row.status,
          row.landlordApprovalStatus,
          row.tenantSelfFix,
        ),
        dateSubmitted: row.dateReported,
      }));

    return { requests };
  } catch (error) {
    console.error("[assistant] get_repair_requests threw:", error);
    return { error: TENANT_DATA_UNAVAILABLE_MESSAGE };
  }
}

/**
 * Read-only complaints — same query as /portal/complaints.
 */
export async function getComplaints(): Promise<ComplaintsToolResult> {
  try {
    const sessionResult = await requirePortalLesseeSession();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const admin = createAdminClient();
    const { rows, fetchError } = await fetchComplaintsForLessee(
      admin,
      sessionResult.session.tenantId,
      sessionResult.session.lesseeId,
    );

    if (fetchError) {
      console.error("[assistant] get_complaints failed:", fetchError);
      return { error: TENANT_DATA_UNAVAILABLE_MESSAGE };
    }

    const complaints = rows.slice(0, LIST_LIMIT).map((row) => ({
      description: row.subject,
      status: formatComplaintStatusLabel(
        row.status,
        row.raisedBy,
        row.tenantAcknowledgedAt,
      ),
      dateFiled: row.dateReported,
    }));

    return { complaints };
  } catch (error) {
    console.error("[assistant] get_complaints threw:", error);
    return { error: TENANT_DATA_UNAVAILABLE_MESSAGE };
  }
}

/**
 * Combined repairs + complaints — same merge/sort as /portal/issues.
 */
export async function getMyIssues(): Promise<MyIssuesToolResult> {
  try {
    const sessionResult = await requirePortalLesseeSession();
    if ("error" in sessionResult) {
      return sessionResult;
    }

    const admin = createAdminClient();
    const [maintenance, complaints] = await Promise.all([
      fetchMaintenanceRequestsForLessee(
        admin,
        sessionResult.session.tenantId,
        sessionResult.session.lesseeId,
      ),
      fetchComplaintsForLessee(
        admin,
        sessionResult.session.tenantId,
        sessionResult.session.lesseeId,
      ),
    ]);

    const fetchError = maintenance.fetchError ?? complaints.fetchError;
    if (fetchError) {
      console.error("[assistant] get_my_issues failed:", fetchError);
      return { error: TENANT_DATA_UNAVAILABLE_MESSAGE };
    }

    const issues: MyIssueItem[] = [
      ...maintenance.rows
        .filter((row) => row.reportedBy === "tenant")
        .map((row) => ({
          type: "repair" as const,
          description: row.description,
          status: formatRepairStatusLabel(
            row.status,
            row.landlordApprovalStatus,
            row.tenantSelfFix,
          ),
          date: row.dateReported,
        })),
      ...complaints.rows.map((row) => ({
        type: "complaint" as const,
        description: row.subject,
        status: formatComplaintStatusLabel(
          row.status,
          row.raisedBy,
          row.tenantAcknowledgedAt,
        ),
        date: row.dateReported,
      })),
    ]
      .sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      )
      .slice(0, LIST_LIMIT);

    return { issues };
  } catch (error) {
    console.error("[assistant] get_my_issues threw:", error);
    return { error: TENANT_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function executeAssistantTool(
  toolName: string,
  persona: HandbookPersona,
  toolInput?: unknown,
): Promise<unknown> {
  if (persona === "tenant") {
    if (toolName === GET_RENT_BALANCE_TOOL_NAME) {
      return getRentBalance();
    }

    if (toolName === GET_LEASE_SUMMARY_TOOL_NAME) {
      return getLeaseSummary();
    }

    if (toolName === GET_REPAIR_REQUESTS_TOOL_NAME) {
      return getRepairRequests();
    }

    if (toolName === GET_COMPLAINTS_TOOL_NAME) {
      return getComplaints();
    }

    if (toolName === GET_MY_ISSUES_TOOL_NAME) {
      return getMyIssues();
    }

    return { error: `Unknown tool: ${toolName}` };
  }

  if (persona === "landlord") {
    const { executeLandlordAssistantTool } = await import(
      "@/utils/assistant-landlord-tools"
    );
    return executeLandlordAssistantTool(toolName, toolInput);
  }

  if (persona === "staff") {
    const { executeStaffAssistantTool } = await import(
      "@/utils/assistant-staff-tools"
    );
    return executeStaffAssistantTool(toolName, toolInput);
  }

  return { error: "This tool is not available for your account type." };
}

export function tenantAccountToolsSystemPromptAddition(): string {
  return `Account tools (tenant only — call before answering, never guess):
- get_rent_balance: rent owed, balance, arrears, payment due dates
- get_lease_summary: property, unit, monthly rent, lease status, start/end dates
- get_repair_requests: repair/maintenance requests the tenant submitted
- get_complaints: complaints (tenant- or landlord-raised)
- get_my_issues: combined repairs + complaints timeline (same as the My Issues portal page — use for broad "what issues do I have" questions; prefer get_repair_requests or get_complaints when the user asks about one type only)

Only share values returned by these tools. If a tool reports an error, explain it honestly. For other account-specific data not covered by your tools (e.g. invoices), explain that capability is coming soon.`;
}
