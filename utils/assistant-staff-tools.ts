import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { getPendingApprovals } from "@/utils/assistant-staff-tools-approvals";
import { getUserAccountSummary } from "@/utils/assistant-staff-tools-admin";
import {
  getCommissionSummary,
  getQuotesAndQuotationsStatus,
  getSalesPipelineSummary,
  getSalesSummary,
  getTopCustomers,
} from "@/utils/assistant-staff-tools-crm";
import {
  getBalanceSheetStatus,
  getBudgetStatus,
  getExpenseBreakdown,
  getFinancialSummary,
  getFixedAssetsSummary,
  getOutstandingInvoices,
  getOutstandingPayables,
  getServiceContractsStatus,
  getTaxLedgerStatus,
} from "@/utils/assistant-staff-tools-finance";
import {
  getEmployeeHeadcount,
  getPayrollStatus,
} from "@/utils/assistant-staff-tools-hr";
import {
  getFinishedProductsSummary,
  getProductionSummary,
  getPurchasingSummary,
  getRawMaterialsStock,
} from "@/utils/assistant-staff-tools-inventory";
import {
  getDutyRosterSummary,
  getOpenWorkItems,
} from "@/utils/assistant-staff-tools-operations";
import {
  getLeaseExpirationsOverview,
  getPropertiesOverview,
  getRentCollectionOverview,
} from "@/utils/assistant-staff-tools-realestate";
import {
  STAFF_FINANCIAL_PERIODS,
  isStaffPortalRole,
} from "@/utils/assistant-staff-tool-common";
import {
  canAccessCrmSection,
  canAccessFinanceSection,
  canAccessHrManagementSection,
  canAccessHrPayrollSection,
  canAccessInventorySection,
  canAccessOperationsSection,
  canAccessPosSection,
} from "@/utils/rbac-access";

export {
  STAFF_FINANCIAL_PERIODS,
  type StaffFinancialPeriod,
} from "@/utils/assistant-staff-tool-common";

export const GET_FINANCIAL_SUMMARY_TOOL_NAME = "get_financial_summary";
export const GET_BALANCE_SHEET_STATUS_TOOL_NAME = "get_balance_sheet_status";
export const GET_BUDGET_STATUS_TOOL_NAME = "get_budget_status";
export const GET_OUTSTANDING_INVOICES_TOOL_NAME = "get_outstanding_invoices";
export const GET_OUTSTANDING_PAYABLES_TOOL_NAME = "get_outstanding_payables";
export const GET_TAX_LEDGER_STATUS_TOOL_NAME = "get_tax_ledger_status";
export const GET_EXPENSE_BREAKDOWN_TOOL_NAME = "get_expense_breakdown";
export const GET_FIXED_ASSETS_SUMMARY_TOOL_NAME = "get_fixed_assets_summary";
export const GET_SERVICE_CONTRACTS_STATUS_TOOL_NAME =
  "get_service_contracts_status";
export const GET_PROPERTIES_OVERVIEW_TOOL_NAME = "get_properties_overview";
export const GET_RENT_COLLECTION_OVERVIEW_TOOL_NAME =
  "get_rent_collection_overview";
export const GET_LEASE_EXPIRATIONS_OVERVIEW_TOOL_NAME =
  "get_lease_expirations_overview";
export const GET_FINISHED_PRODUCTS_SUMMARY_TOOL_NAME =
  "get_finished_products_summary";
export const GET_RAW_MATERIALS_STOCK_TOOL_NAME = "get_raw_materials_stock";
export const GET_PRODUCTION_SUMMARY_TOOL_NAME = "get_production_summary";
export const GET_PURCHASING_SUMMARY_TOOL_NAME = "get_purchasing_summary";
export const GET_SALES_SUMMARY_TOOL_NAME = "get_sales_summary";
export const GET_TOP_CUSTOMERS_TOOL_NAME = "get_top_customers";
export const GET_SALES_PIPELINE_SUMMARY_TOOL_NAME = "get_sales_pipeline_summary";
export const GET_QUOTES_AND_QUOTATIONS_STATUS_TOOL_NAME =
  "get_quotes_and_quotations_status";
export const GET_COMMISSION_SUMMARY_TOOL_NAME = "get_commission_summary";
export const GET_EMPLOYEE_HEADCOUNT_TOOL_NAME = "get_employee_headcount";
export const GET_PAYROLL_STATUS_TOOL_NAME = "get_payroll_status";
export const GET_DUTY_ROSTER_SUMMARY_TOOL_NAME = "get_duty_roster_summary";
export const GET_OPEN_WORK_ITEMS_TOOL_NAME = "get_open_work_items";
export const GET_USER_ACCOUNT_SUMMARY_TOOL_NAME = "get_user_account_summary";
export const GET_PENDING_APPROVALS_TOOL_NAME = "get_pending_approvals";

export type StaffAssistantToolsOptions = {
  showRealEstate?: boolean;
};

const PERIOD_SCHEMA = {
  period: {
    type: "string",
    enum: [...STAFF_FINANCIAL_PERIODS],
    description:
      'Reporting window: "this_month" (default), "last_month", or "ytd".',
  },
} as const;

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
): Anthropic.Tool {
  return {
    name,
    description,
    input_schema: {
      type: "object",
      properties,
      required: [],
      additionalProperties: false,
    },
  };
}

export function getStaffAssistantTools(
  role: AppRole | null,
  options?: StaffAssistantToolsOptions,
): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];

  if (canAccessFinanceSection(role)) {
    tools.push(
      tool(
        GET_FINANCIAL_SUMMARY_TOOL_NAME,
        "Revenue, expenses, and net profit for this_month (default), last_month, or ytd — same as Dashboard financial summary cards.",
        PERIOD_SCHEMA,
      ),
      tool(
        GET_BALANCE_SHEET_STATUS_TOOL_NAME,
        "Current Balance Sheet Check (balanced vs out-of-balance) — same as the Dashboard card.",
      ),
      tool(
        GET_BUDGET_STATUS_TOOL_NAME,
        "Budget vs Actual in Monthly (Pro-rated) mode — budgeted, actual, variance, and status per expense category. Optional month (1–12), year, and project_id (omit project for company-wide All view).",
        {
          month: {
            type: "number",
            description: "Calendar month 1–12 (default: current month).",
          },
          year: {
            type: "number",
            description: "Calendar year (default: current year).",
          },
          project_id: {
            type: "string",
            description:
              "Optional project UUID for a single project/contract; omit for company-wide All view.",
          },
        },
      ),
      tool(
        GET_OUTSTANDING_INVOICES_TOOL_NAME,
        "Unpaid client invoices with aging buckets, capped at 20 — Finance Client Invoices register.",
      ),
      tool(
        GET_OUTSTANDING_PAYABLES_TOOL_NAME,
        "Outstanding Accounts Payable owed to suppliers, capped at 20.",
      ),
      tool(
        GET_TAX_LEDGER_STATUS_TOOL_NAME,
        "Open WHT/VAT/PAYE/SSNIT statutory position — same aggregation as Statutory Liabilities report.",
      ),
      tool(
        GET_EXPENSE_BREAKDOWN_TOOL_NAME,
        "Top expense categories for this_month (default), last_month, or ytd — Dashboard Spending Analysis.",
        PERIOD_SCHEMA,
      ),
      tool(
        GET_FIXED_ASSETS_SUMMARY_TOOL_NAME,
        "Fixed asset count, cost, depreciation, and net book value — Fixed Asset & Depreciation Schedule report.",
      ),
      tool(
        GET_SERVICE_CONTRACTS_STATUS_TOOL_NAME,
        "Active service contracts and any due for renewal within 60 days.",
      ),
    );
  }

  if (options?.showRealEstate === true) {
    tools.push(
      tool(
        GET_PROPERTIES_OVERVIEW_TOOL_NAME,
        "Platform-wide portfolio summary: landlords, properties, units, occupancy — Davors-managed Real Estate.",
      ),
      tool(
        GET_RENT_COLLECTION_OVERVIEW_TOOL_NAME,
        "Platform-wide rent collection for the current month plus overdue tenants.",
      ),
      tool(
        GET_LEASE_EXPIRATIONS_OVERVIEW_TOOL_NAME,
        "Leases expiring soon across the Davors-managed portfolio. Optional upcomingMonths (default 3, max 12).",
        {
          upcomingMonths: {
            type: "number",
            description: "Months ahead to include (default 3).",
          },
        },
      ),
    );
  }

  if (canAccessInventorySection(role)) {
    tools.push(
      tool(
        GET_FINISHED_PRODUCTS_SUMMARY_TOOL_NAME,
        "Finished product stock levels, low/out-of-stock counts, and expiry alerts.",
      ),
      tool(
        GET_RAW_MATERIALS_STOCK_TOOL_NAME,
        "Raw material stock levels with unit of measure and weighted average cost per unit.",
      ),
      tool(
        GET_PRODUCTION_SUMMARY_TOOL_NAME,
        "Recent production batches — count and latest items produced.",
      ),
      tool(
        GET_PURCHASING_SUMMARY_TOOL_NAME,
        "Open purchase orders and recent product purchases.",
      ),
    );
  }

  if (canAccessCrmSection(role) || canAccessPosSection(role)) {
    tools.push(
      tool(
        GET_SALES_SUMMARY_TOOL_NAME,
        "Sales totals and top products for this_month (default), last_month, or ytd.",
        PERIOD_SCHEMA,
      ),
    );
  }

  if (canAccessCrmSection(role)) {
    tools.push(
      tool(
        GET_TOP_CUSTOMERS_TOOL_NAME,
        "Top customers by revenue for this_month (default), last_month, or ytd, capped at 10.",
        PERIOD_SCHEMA,
      ),
      tool(
        GET_SALES_PIPELINE_SUMMARY_TOOL_NAME,
        "Open Sales Pipeline opportunities grouped by stage.",
      ),
      tool(
        GET_QUOTES_AND_QUOTATIONS_STATUS_TOOL_NAME,
        "Open/pending Client Quotations and Product Quotes, capped at 20 combined.",
      ),
      tool(
        GET_COMMISSION_SUMMARY_TOOL_NAME,
        "Pending and recent sales commission calculations.",
      ),
    );
  } else if (canAccessPosSection(role)) {
    tools.push(
      tool(
        GET_QUOTES_AND_QUOTATIONS_STATUS_TOOL_NAME,
        "Open/pending Product Quotes from POS/Sales quotes.",
      ),
    );
  }

  if (canAccessHrManagementSection(role)) {
    tools.push(
      tool(
        GET_EMPLOYEE_HEADCOUNT_TOOL_NAME,
        "Active employee headcount by employment type — Headcount report summary.",
      ),
    );
  }

  if (canAccessHrPayrollSection(role)) {
    tools.push(
      tool(
        GET_PAYROLL_STATUS_TOOL_NAME,
        "Current payroll period status — same as Dashboard Payroll Status card.",
      ),
    );
  }

  if (canAccessOperationsSection(role)) {
    tools.push(
      tool(
        GET_DUTY_ROSTER_SUMMARY_TOOL_NAME,
        "Current duty roster staffing status and understaffed sites.",
      ),
      tool(
        GET_OPEN_WORK_ITEMS_TOOL_NAME,
        "Open work orders, failed inspections, and complaint register items, capped at 20.",
      ),
    );
  }

  if (role === "super_admin") {
    tools.push(
      tool(
        GET_USER_ACCOUNT_SUMMARY_TOOL_NAME,
        "User account counts by role (active/inactive) — no individual PII beyond User Accounts page.",
      ),
    );
  }

  if (isStaffPortalRole(role)) {
    tools.push(
      tool(
        GET_PENDING_APPROVALS_TOOL_NAME,
        "Leave requests pending your approval as assigned approver.",
      ),
    );
  }

  return tools;
}

export async function executeStaffAssistantTool(
  toolName: string,
  toolInput?: unknown,
): Promise<unknown> {
  switch (toolName) {
    case GET_FINANCIAL_SUMMARY_TOOL_NAME:
      return getFinancialSummary(toolInput);
    case GET_BALANCE_SHEET_STATUS_TOOL_NAME:
      return getBalanceSheetStatus();
    case GET_BUDGET_STATUS_TOOL_NAME:
      return getBudgetStatus(toolInput);
    case GET_OUTSTANDING_INVOICES_TOOL_NAME:
      return getOutstandingInvoices();
    case GET_OUTSTANDING_PAYABLES_TOOL_NAME:
      return getOutstandingPayables();
    case GET_TAX_LEDGER_STATUS_TOOL_NAME:
      return getTaxLedgerStatus();
    case GET_EXPENSE_BREAKDOWN_TOOL_NAME:
      return getExpenseBreakdown(toolInput);
    case GET_FIXED_ASSETS_SUMMARY_TOOL_NAME:
      return getFixedAssetsSummary();
    case GET_SERVICE_CONTRACTS_STATUS_TOOL_NAME:
      return getServiceContractsStatus();
    case GET_PROPERTIES_OVERVIEW_TOOL_NAME:
      return getPropertiesOverview();
    case GET_RENT_COLLECTION_OVERVIEW_TOOL_NAME:
      return getRentCollectionOverview();
    case GET_LEASE_EXPIRATIONS_OVERVIEW_TOOL_NAME:
      return getLeaseExpirationsOverview(toolInput);
    case GET_FINISHED_PRODUCTS_SUMMARY_TOOL_NAME:
      return getFinishedProductsSummary();
    case GET_RAW_MATERIALS_STOCK_TOOL_NAME:
      return getRawMaterialsStock();
    case GET_PRODUCTION_SUMMARY_TOOL_NAME:
      return getProductionSummary();
    case GET_PURCHASING_SUMMARY_TOOL_NAME:
      return getPurchasingSummary();
    case GET_SALES_SUMMARY_TOOL_NAME:
      return getSalesSummary(toolInput);
    case GET_TOP_CUSTOMERS_TOOL_NAME:
      return getTopCustomers(toolInput);
    case GET_SALES_PIPELINE_SUMMARY_TOOL_NAME:
      return getSalesPipelineSummary();
    case GET_QUOTES_AND_QUOTATIONS_STATUS_TOOL_NAME:
      return getQuotesAndQuotationsStatus();
    case GET_COMMISSION_SUMMARY_TOOL_NAME:
      return getCommissionSummary();
    case GET_EMPLOYEE_HEADCOUNT_TOOL_NAME:
      return getEmployeeHeadcount();
    case GET_PAYROLL_STATUS_TOOL_NAME:
      return getPayrollStatus();
    case GET_DUTY_ROSTER_SUMMARY_TOOL_NAME:
      return getDutyRosterSummary();
    case GET_OPEN_WORK_ITEMS_TOOL_NAME:
      return getOpenWorkItems();
    case GET_USER_ACCOUNT_SUMMARY_TOOL_NAME:
      return getUserAccountSummary();
    case GET_PENDING_APPROVALS_TOOL_NAME:
      return getPendingApprovals();
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

export function staffAccountToolsSystemPromptAddition(
  role: AppRole | null,
  options?: StaffAssistantToolsOptions,
): string {
  const lines: string[] = [
    "Account tools (staff only — call before answering account-specific questions, never guess):",
  ];

  if (canAccessFinanceSection(role)) {
    lines.push(
      "- get_financial_summary / get_balance_sheet_status: Dashboard financial summary and balance sheet check",
      "- get_budget_status: Budget vs Actual (Monthly Pro-rated) — budgeted/actual/variance/status per category (optional month, year, project_id); use for budget status, budget vs actual, over/under budget, and category spend vs budget questions instead of handbook RAG",
      "- get_outstanding_invoices / get_outstanding_payables: unpaid client invoices and supplier payables with aging",
      "- get_tax_ledger_status: open WHT/VAT/PAYE/SSNIT statutory balances",
      "- get_expense_breakdown: top expense categories (optional period: this_month, last_month, ytd)",
      "- get_fixed_assets_summary / get_service_contracts_status: fixed assets schedule summary and active service contracts due for renewal",
    );
  }

  if (options?.showRealEstate === true) {
    lines.push(
      "- get_properties_overview / get_rent_collection_overview / get_lease_expirations_overview: Davors platform Real Estate portfolio (narrow access — super_admin/director on Davors tenant only)",
    );
  }

  if (canAccessInventorySection(role)) {
    lines.push(
      "- get_finished_products_summary / get_raw_materials_stock / get_production_summary / get_purchasing_summary: Inventory finished products, raw materials stock, production batches, and purchasing/PO status",
    );
  }

  if (canAccessCrmSection(role) || canAccessPosSection(role)) {
    lines.push(
      "- get_sales_summary: sales totals for this_month, last_month, or ytd",
    );
  }

  if (canAccessCrmSection(role)) {
    lines.push(
      "- get_top_customers / get_sales_pipeline_summary / get_quotes_and_quotations_status / get_commission_summary: CRM sales pipeline, quotes, and commissions",
    );
  } else if (canAccessPosSection(role)) {
    lines.push(
      "- get_quotes_and_quotations_status: open Product Quotes (POS)",
    );
  }

  if (canAccessHrManagementSection(role)) {
    lines.push("- get_employee_headcount: active headcount by employment type");
  }

  if (canAccessHrPayrollSection(role)) {
    lines.push("- get_payroll_status: Dashboard Payroll Status card data");
  }

  if (canAccessOperationsSection(role)) {
    lines.push(
      "- get_duty_roster_summary / get_open_work_items: duty roster understaffing and open work orders/inspections/complaints",
    );
  }

  if (role === "super_admin") {
    lines.push(
      "- get_user_account_summary: user account counts by role (no extra PII)",
    );
  }

  if (isStaffPortalRole(role)) {
    lines.push(
      "- get_pending_approvals: leave requests pending your approval only",
    );
  }

  if (lines.length === 1) {
    return `${lines[0]}
You do not have role-based account tools for this workspace.

When asked about workspace data you cannot retrieve, explain politely that their current role does not include access — do not say the assistant lacks the capability or that it is "coming soon". Name the relevant Dashboard module when obvious (Finance, Operations, Inventory, Sales & CRM, HR Management, Real Estate, Administration) and suggest they contact an administrator if they need that access.`;
  }

  lines.push(
    "Only share values returned by your available tools. If a tool reports an error, explain it honestly.",
    "",
    "Access vs missing features: If the user asks about workspace data you cannot retrieve because no matching tool appears in YOUR list above, do NOT say you lack the capability, do not have a tool, or that the feature is coming soon. Other staff roles may have assistant tools for that data. Explain that the information is not available to their current role, name the relevant Dashboard module when you can infer it (Finance, Operations, Inventory, Sales & CRM, HR Management, Real Estate, Administration), and suggest they check with an administrator about module access if they need it. Keep the same polite, helpful tone.",
    "",
    "Genuinely unavailable (not role-gated): get_returns_summary and get_workspace_settings_summary are not implemented for any role yet — only mention these if asked specifically about returns/credit notes or workspace settings completeness.",
  );

  return lines.join("\n");
}

// Re-export for callers/tests that imported handlers from this module.
export {
  getFinancialSummary,
  getBalanceSheetStatus,
  getBudgetStatus,
  getPendingApprovals,
};
