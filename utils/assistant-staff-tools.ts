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
  getSupplierContractsStatus,
  getTaxLedgerStatus,
} from "@/utils/assistant-staff-tools-finance";
import { getDirectorScorecard } from "@/utils/assistant-staff-tools-director-scorecard";
import {
  getContractProfitabilitySummary,
  getCostTaggingHealth,
  getInterUnitTransfers,
} from "@/utils/assistant-staff-tools-finance-ext";
import {
  getConsumablesSiteUsage,
  getConsumablesStoreStock,
} from "@/utils/assistant-staff-tools-consumables";
import {
  getContractExpiryList,
  getEmployeeAttendanceSummary,
  getEmployeeHeadcount,
  getEmployeeLeaveBalance,
  getEmployeeLeaveHistory,
  getEmployeeLeaveHistoryRegister,
  getEmployeeProfile,
  getPayrollStatus,
  searchEmployees,
} from "@/utils/assistant-staff-tools-hr";
import {
  getEmployeeCompensation,
  getEmployeeLoans,
  getEmployeeOvertimeSummary,
  getEmployeePayDetail,
  getStaffWelfareFundStatus,
} from "@/utils/assistant-staff-tools-hr-payroll";
import { getDisciplinaryRecords } from "@/utils/assistant-staff-tools-hr-disciplinary";
import { canAccessDisciplinaryRecords } from "@/utils/assistant-staff-tools-hr-common";
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
export const GET_SUPPLIER_CONTRACTS_STATUS_TOOL_NAME =
  "get_supplier_contracts_status";
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
export const GET_STAFF_WELFARE_FUND_STATUS_TOOL_NAME =
  "get_staff_welfare_fund_status";
export const SEARCH_EMPLOYEES_TOOL_NAME = "search_employees";
export const GET_EMPLOYEE_PROFILE_TOOL_NAME = "get_employee_profile";
export const GET_EMPLOYEE_LEAVE_BALANCE_TOOL_NAME = "get_employee_leave_balance";
export const GET_EMPLOYEE_LEAVE_HISTORY_REGISTER_TOOL_NAME =
  "get_employee_leave_history_register";
export const GET_EMPLOYEE_LEAVE_HISTORY_TOOL_NAME = "get_employee_leave_history";
export const GET_EMPLOYEE_ATTENDANCE_SUMMARY_TOOL_NAME =
  "get_employee_attendance_summary";
export const GET_CONTRACT_EXPIRY_LIST_TOOL_NAME = "get_contract_expiry_list";
export const GET_EMPLOYEE_COMPENSATION_TOOL_NAME = "get_employee_compensation";
export const GET_EMPLOYEE_PAY_DETAIL_TOOL_NAME = "get_employee_pay_detail";
export const GET_EMPLOYEE_OVERTIME_SUMMARY_TOOL_NAME =
  "get_employee_overtime_summary";
export const GET_EMPLOYEE_LOANS_TOOL_NAME = "get_employee_loans";
export const GET_DISCIPLINARY_RECORDS_TOOL_NAME = "get_disciplinary_records";
export const GET_DUTY_ROSTER_SUMMARY_TOOL_NAME = "get_duty_roster_summary";
export const GET_OPEN_WORK_ITEMS_TOOL_NAME = "get_open_work_items";
export const GET_USER_ACCOUNT_SUMMARY_TOOL_NAME = "get_user_account_summary";
export const GET_PENDING_APPROVALS_TOOL_NAME = "get_pending_approvals";
export const GET_CONTRACT_PROFITABILITY_SUMMARY_TOOL_NAME =
  "get_contract_profitability_summary";
export const GET_COST_TAGGING_HEALTH_TOOL_NAME = "get_cost_tagging_health";
export const GET_INTER_UNIT_TRANSFERS_TOOL_NAME = "get_inter_unit_transfers";
export const GET_DIRECTOR_SCORECARD_TOOL_NAME = "get_director_scorecard";
export const GET_CONSUMABLES_STORE_STOCK_TOOL_NAME =
  "get_consumables_store_stock";
export const GET_CONSUMABLES_SITE_USAGE_TOOL_NAME = "get_consumables_site_usage";

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
  required: string[] = [],
): Anthropic.Tool {
  return {
    name,
    description,
    input_schema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

const EMPLOYEE_ID_SCHEMA = {
  employeeId: {
    type: "string",
    description:
      "Employee UUID or staff ID (e.g. DF-STAFF-001). Must be in the active business unit scope.",
  },
} as const;

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
        "Balance Sheet Check (balanced vs out-of-balance) for the dashboard month with key liability lines, Director's Loan liability (company owes director), Due from Director asset (director owes company), net Director's Loan position label, and when viewing a single business unit — Due from/to other business units from the same balance sheet build. AP is month-end outstanding (later-dated payments do not rewrite earlier months).",
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
        "Open WHT/VAT/PAYE/SSNIT balances and per-period due dates/overdue items — same due-rule engine as Finance → Statutory Ledger.",
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
      tool(
        GET_SUPPLIER_CONTRACTS_STATUS_TOOL_NAME,
        "Active supplier contracts: monthly amount, next billing, credit balance, this month's AP — detail UI has summary card, Activate, Edit contract, Monthly bills (AP), replacement payment (method + notes). Finance → Supplier Contracts.",
      ),
      tool(
        GET_CONTRACT_PROFITABILITY_SUMMARY_TOOL_NAME,
        "Contract Profitability for a calendar month — answers questions like how much did <client> make us, profit on <contract>, margin for <project/contract> in <month>. Returns revenue, labour, direct costs, overhead allocated, margin and margin % per contract/project (matches Reports → Contract Profitability). Optional allocationMode: none (default), revenue (by revenue share), headcount. contractOrProjectName matches client name, contract number, project code/name, or site (case-insensitive); if no match, returns available names for Did you mean …?",
        {
          month: { type: "number", description: "Calendar month 1–12." },
          year: { type: "number", description: "Calendar year." },
          allocationMode: {
            type: "string",
            description:
              "Overhead allocation: none, revenue, or headcount (same as Reports → Contract Profitability).",
          },
          contractOrProjectName: {
            type: "string",
            description:
              "Client, contract, or project filter (e.g. Central University, PRJ01, UGMC) — partial match on customer, contract number, project code/name, or linked site.",
          },
        },
        ["month", "year"],
      ),
      tool(
        GET_COST_TAGGING_HEALTH_TOOL_NAME,
        "Cost tagging health for a month — counts/totals of untagged expense_register (excluding payroll labour rows), accounts_payable, and supplier_contracts without project_id; top 5 untagged by amount; projects missing service_contract_id. Optional month/year (default current month).",
        {
          month: { type: "number", description: "Calendar month 1–12." },
          year: { type: "number", description: "Calendar year." },
        },
      ),
      tool(
        GET_INTER_UNIT_TRANSFERS_TOOL_NAME,
        "Inter-unit transfers between business units — dated movements plus net position per unit pair (same summary card as Finance → Inter-unit Transfers). Optional fromDate, toDate, limit (max 20).",
        {
          fromDate: { type: "string", description: "ISO date YYYY-MM-DD." },
          toDate: { type: "string", description: "ISO date YYYY-MM-DD." },
          limit: { type: "number", description: "Max transfers returned (default 20)." },
        },
      ),
      tool(
        GET_DIRECTOR_SCORECARD_TOOL_NAME,
        "Director's Scorecard for a calendar month — same figures as Dashboard → Director's Scorecard (revenue, costs, PBT, CIT/GSL/WHT credit, tax to set aside, PAT, tenant-configured profit split, quarter dividend gross/WHT/net, scorecardPlanningRates for CIT/GSL/dividend WHT/split percentages, five dividend checklist items with Done/To do/Overdue, over-budget budget lines). Directors and super_admin only; other roles receive an access message with no figures. Month without year uses the most recent occurrence (Accra). Always call this for dividend safety, scorecard tax-to-set-aside, and which rates the scorecard uses before answering.",
        {
          month: {
            type: "number",
            description: "Calendar month 1–12 (default: current month in Accra).",
          },
          year: {
            type: "number",
            description:
              "Calendar year (optional; if omitted, month resolves to the latest occurrence on or before today).",
          },
        },
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
        SEARCH_EMPLOYEES_TOOL_NAME,
        "Find employees by name, staff ID, or department. Returns up to 10 matches with no salary data.",
        {
          query: {
            type: "string",
            description: "Name, staff ID, or department text to search for.",
          },
        },
        ["query"],
      ),
      tool(
        GET_EMPLOYEE_PROFILE_TOOL_NAME,
        "Employee profile: position, department, employment type, supervisor, contact info, status, hire date. No pay data.",
        EMPLOYEE_ID_SCHEMA,
        ["employeeId"],
      ),
      tool(
        GET_EMPLOYEE_LEAVE_BALANCE_TOOL_NAME,
        "Current-year leave entitlement remaining (entitled/used/remaining per leave type) — same as HR → Leave Balances. Use for 'how many days left' questions.",
        EMPLOYEE_ID_SCHEMA,
        ["employeeId"],
      ),
      tool(
        GET_EMPLOYEE_LEAVE_HISTORY_REGISTER_TOOL_NAME,
        "Manual Leave register entries (leave_management) in report shape — recorded leave episodes with optional per-row balance snapshot. NOT current entitlement; do not use for 'how many days left'.",
        EMPLOYEE_ID_SCHEMA,
        ["employeeId"],
      ),
      tool(
        GET_EMPLOYEE_LEAVE_HISTORY_TOOL_NAME,
        "Chronological leave episodes from the manual Leave register with start/end dates. Optional approval status filter (Pending, Approved, Rejected). Not self-service leave_requests; not entitlement remaining.",
        {
          ...EMPLOYEE_ID_SCHEMA,
          status: {
            type: "string",
            description:
              "Optional approval status filter: Pending, Approved, or Rejected.",
          },
        },
        ["employeeId"],
      ),
      tool(
        GET_EMPLOYEE_ATTENDANCE_SUMMARY_TOOL_NAME,
        "Attendance summary for this_month (default) or last_month — one employee or all scoped employees.",
        {
          ...EMPLOYEE_ID_SCHEMA,
          ...PERIOD_SCHEMA,
        },
      ),
      tool(
        GET_EMPLOYEE_HEADCOUNT_TOOL_NAME,
        "Active employee headcount by employment type — Headcount report summary.",
      ),
      tool(
        GET_CONTRACT_EXPIRY_LIST_TOOL_NAME,
        "Contracts expiring within 30 days or past expiry while still active — Headcount & Contract Expiry report.",
      ),
    );
  }

  if (canAccessHrPayrollSection(role)) {
    tools.push(
      tool(
        GET_PAYROLL_STATUS_TOOL_NAME,
        "Current payroll period status — same as Dashboard Payroll Status card. pendingPayrollLiabilitiesGhs is statutory tax liabilities only (open PAYE and SSNIT), not total payroll liabilities and excluding Staff Welfare Payable; use get_staff_welfare_fund_status for welfare fund balance and history.",
      ),
      tool(
        GET_STAFF_WELFARE_FUND_STATUS_TOOL_NAME,
        "Staff Welfare Fund balance (open accruals minus disbursements) and recent ledger history — same as Finance → Staff Welfare Fund.",
      ),
      tool(
        GET_EMPLOYEE_COMPENSATION_TOOL_NAME,
        "Salary and allowance structure for one employee from compensation policy, plus welfare deduction rate (no payslip deductions).",
        EMPLOYEE_ID_SCHEMA,
        ["employeeId"],
      ),
      tool(
        GET_EMPLOYEE_PAY_DETAIL_TOOL_NAME,
        "Payslip figures for one employee for this_month (default) or last_month, including welfareDeductionGhs.",
        {
          ...EMPLOYEE_ID_SCHEMA,
          ...PERIOD_SCHEMA,
        },
        ["employeeId"],
      ),
      tool(
        GET_EMPLOYEE_OVERTIME_SUMMARY_TOOL_NAME,
        "Overtime hours and amounts for this_month (default) or last_month — optional employee filter.",
        {
          ...EMPLOYEE_ID_SCHEMA,
          ...PERIOD_SCHEMA,
        },
      ),
      tool(
        GET_EMPLOYEE_LOANS_TOOL_NAME,
        "Loan/advance balances — optional employee filter; all scoped employees when omitted.",
        EMPLOYEE_ID_SCHEMA,
      ),
    );
  }

  if (canAccessDisciplinaryRecords(role)) {
    tools.push(
      tool(
        GET_DISCIPLINARY_RECORDS_TOOL_NAME,
        "Disciplinary records — optional employee filter; capped at 20 most recent.",
        EMPLOYEE_ID_SCHEMA,
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
      tool(
        GET_CONSUMABLES_STORE_STOCK_TOOL_NAME,
        "Operations → Consumables store stock — on hand, weighted average cost, stock value, minimum level, status. Optional itemName filter and status filter (low or out).",
        {
          itemName: { type: "string", description: "Partial item name or code." },
          status: {
            type: "string",
            description: "Optional: low or out (stock status).",
          },
        },
      ),
      tool(
        GET_CONSUMABLES_SITE_USAGE_TOOL_NAME,
        "Operations → Consumables site usage — net quantity and value issued minus returned per site/contract/item for a period. Optional month/year (current month) or fromDate/toDate; optional siteName filter.",
        {
          month: { type: "number", description: "Calendar month 1–12." },
          year: { type: "number", description: "Calendar year." },
          fromDate: { type: "string", description: "ISO date YYYY-MM-DD." },
          toDate: { type: "string", description: "ISO date YYYY-MM-DD." },
          siteName: { type: "string", description: "Partial site name filter." },
        },
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
    case GET_SUPPLIER_CONTRACTS_STATUS_TOOL_NAME:
      return getSupplierContractsStatus();
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
    case GET_STAFF_WELFARE_FUND_STATUS_TOOL_NAME:
      return getStaffWelfareFundStatus();
    case SEARCH_EMPLOYEES_TOOL_NAME:
      return searchEmployees(toolInput);
    case GET_EMPLOYEE_PROFILE_TOOL_NAME:
      return getEmployeeProfile(toolInput);
    case GET_EMPLOYEE_LEAVE_BALANCE_TOOL_NAME:
      return getEmployeeLeaveBalance(toolInput);
    case GET_EMPLOYEE_LEAVE_HISTORY_REGISTER_TOOL_NAME:
      return getEmployeeLeaveHistoryRegister(toolInput);
    case GET_EMPLOYEE_LEAVE_HISTORY_TOOL_NAME:
      return getEmployeeLeaveHistory(toolInput);
    case GET_EMPLOYEE_ATTENDANCE_SUMMARY_TOOL_NAME:
      return getEmployeeAttendanceSummary(toolInput);
    case GET_CONTRACT_EXPIRY_LIST_TOOL_NAME:
      return getContractExpiryList();
    case GET_EMPLOYEE_COMPENSATION_TOOL_NAME:
      return getEmployeeCompensation(toolInput);
    case GET_EMPLOYEE_PAY_DETAIL_TOOL_NAME:
      return getEmployeePayDetail(toolInput);
    case GET_EMPLOYEE_OVERTIME_SUMMARY_TOOL_NAME:
      return getEmployeeOvertimeSummary(toolInput);
    case GET_EMPLOYEE_LOANS_TOOL_NAME:
      return getEmployeeLoans(toolInput);
    case GET_DISCIPLINARY_RECORDS_TOOL_NAME:
      return getDisciplinaryRecords(toolInput);
    case GET_DUTY_ROSTER_SUMMARY_TOOL_NAME:
      return getDutyRosterSummary();
    case GET_OPEN_WORK_ITEMS_TOOL_NAME:
      return getOpenWorkItems();
    case GET_USER_ACCOUNT_SUMMARY_TOOL_NAME:
      return getUserAccountSummary();
    case GET_PENDING_APPROVALS_TOOL_NAME:
      return getPendingApprovals();
    case GET_CONTRACT_PROFITABILITY_SUMMARY_TOOL_NAME:
      return getContractProfitabilitySummary(toolInput);
    case GET_COST_TAGGING_HEALTH_TOOL_NAME:
      return getCostTaggingHealth(toolInput);
    case GET_INTER_UNIT_TRANSFERS_TOOL_NAME:
      return getInterUnitTransfers(toolInput);
    case GET_CONSUMABLES_STORE_STOCK_TOOL_NAME:
      return getConsumablesStoreStock(toolInput);
    case GET_CONSUMABLES_SITE_USAGE_TOOL_NAME:
      return getConsumablesSiteUsage(toolInput);
    case GET_DIRECTOR_SCORECARD_TOOL_NAME:
      return getDirectorScorecard(toolInput);
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
      "- get_financial_summary / get_balance_sheet_status: Dashboard financial summary and balance sheet check (key liability lines, Director's Loan liability, Due from Director asset, net position label from ledger)",
      "- Director's Loan how-to (handbook §6.5): ledger on Manual Financial Entries; personal company-paid expenses → ledger type 'Company paid for my personal expense', not Expense Register; correct via Edit/Reverse, never delete",
      "- get_budget_status: Budget vs Actual (Monthly Pro-rated) — budgeted/actual/variance/status per category (optional month, year, project_id); use for budget status, budget vs actual, over/under budget, and category spend vs budget questions instead of handbook RAG",
      "- get_outstanding_invoices / get_outstanding_payables: unpaid client invoices and supplier payables with aging",
      "- get_tax_ledger_status: open statutory balances plus per-tax per-period due dates and overdue (Statutory Ledger rules)",
      "- get_expense_breakdown: top expense categories (optional period: this_month, last_month, ytd)",
      "- get_fixed_assets_summary / get_service_contracts_status / get_supplier_contracts_status: fixed assets schedule, service contracts due for renewal, and supplier contract billing/AP status",
      "- get_contract_profitability_summary: Reports → Contract Profitability (NOT Budget vs Actual) — how much did <client> make us, profit/margin/revenue/costs for a named contract or project in a month; pass contractOrProjectName (client name, PRJ code, contract number); optional allocation none/revenue/headcount. Always call this before saying you have no data when the user names a client/contract/project with profit, margin, revenue, or costs.",
      "- get_cost_tagging_health: untagged costs this month on Expense Register, Accounts Payable, and Supplier Contracts; projects with null projects.service_contract_id (same rule as Contract Profitability) — when listing them, add that internal/overhead projects (e.g. office) are expected to have no contract and can be ignored",
      "- get_inter_unit_transfers: Finance → Inter-unit Transfers — internal movements between business units; net pair positions (X owes Y). On a single-unit Balance Sheet these appear as Due from/to other business units; they cancel under View All Businesses",
      "- get_balance_sheet_status now includes Due from/to other business units when present (single-unit view)",
      "- get_director_scorecard: Dashboard Director's Scorecard (directors and super_admin only). Always call for dividend readiness, scorecard tax-to-set-aside, and questions about which CIT/GSL/dividend WHT or profit-split percentages the scorecard uses (read scorecardPlanningRates from the tool). If the tool returns an access error, relay that message exactly and do not quote scorecard figures from other tools.",
    );

    if (role === "director" || role === "super_admin") {
      lines.push(
        "- Dividend answers: state the five-item checklist result first; never say a dividend is safe unless all five checks are Done. Remind users figures are planning figures, not tax advice.",
      );
    }
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
    lines.push(
      "- search_employees: find employees by name, staff ID, or department (no pay data)",
      "- get_employee_profile / get_employee_attendance_summary / get_contract_expiry_list: HR employee lookup and attendance/contract data",
      "- get_employee_leave_balance: current-year entitlement remaining (entitled/used/days left) — use for 'how many days left' questions; same as HR → Leave Balances",
      "- get_employee_leave_history_register: manual Leave register episodes in report shape — NOT days remaining",
      "- get_employee_leave_history: chronological manual Leave register episodes with dates — NOT days remaining; does not include self-service leave_requests unless mirrored in Leave",
      "- get_employee_headcount: active headcount by employment type",
    );
  }

  if (canAccessHrPayrollSection(role)) {
    lines.push(
      "- get_payroll_status: Dashboard Payroll Status card — pendingPayrollLiabilitiesGhs is open PAYE/SSNIT only (not Staff Welfare). Payroll lock is blocked if platform statutory rates are missing for the period (handbook §8.2a)",
      "- get_staff_welfare_fund_status: Staff Welfare Fund balance and recent accrual/disbursement history",
      "- get_employee_compensation / get_employee_pay_detail / get_employee_overtime_summary / get_employee_loans: sensitive payroll and loan data",
    );
  }

  if (canAccessDisciplinaryRecords(role)) {
    lines.push(
      "- get_disciplinary_records: disciplinary register (super_admin, hr, director only)",
    );
  }

  if (canAccessOperationsSection(role)) {
    lines.push(
      "- get_duty_roster_summary / get_open_work_items: duty roster understaffing and open work orders/inspections/complaints",
      "- get_consumables_store_stock / get_consumables_site_usage: Operations → Consumables (Store stock, Receive, Issue to site, Movements, Site usage, Items). Standard units: piece, litre, gallon, kg, box, pack, roll, bottle, carton, pair, set — not grams or ml (use kg / litre). Always answer consumables quantities and values from tools, never estimates",
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

When asked about workspace data you cannot retrieve, explain politely and briefly that their current role does not include access — do not say the assistant lacks the capability or that it is "coming soon". Name the relevant Dashboard module when obvious (Finance, Operations, Inventory, Sales & CRM, HR Management, Real Estate, Administration) and suggest they contact an administrator if they need that access.`;
  }

  lines.push(
    "Workspace entity names: Customer/client names (e.g. Central University), service contracts, projects (PRJ codes), sites, suppliers, and employees refer to records inside the user's own workspace — not external organisations you cannot access. Never answer that you lack data for a named client/contract/project until you have called the relevant account tool.",
    "",
    "Reporting dates (Africa/Accra): When the user names a month without a year (e.g. September), pass month only — omit year so tools resolve the most recent occurrence of that month on or before today (October 2026 → September = month 9 with no year → September 2026; November → November 2025). If the user states a year, pass that year. last month = previous calendar month; this quarter = current calendar quarter through today.",
    "",
    "Contract/client profitability: When a question names a client, contract, or project together with profit, margin, revenue, or costs, call get_contract_profitability_summary with month, year, and contractOrProjectName set to that name — do not refuse or guess first. If the tool returns availableContractOrProjectNames, ask Did you mean …?",
    "",
    "Only share values returned by your available tools — never estimate financial or stock figures. If a tool reports an error, explain it honestly.",
    "",
    "Business unit scope: All account tool results are scoped to the active business unit in the header switcher (or all units when View All is selected).",
    "",
    "Payroll liabilities: pendingPayrollLiabilitiesGhs from get_payroll_status covers open statutory tax liabilities (PAYE/SSNIT) only — not Staff Welfare Payable. Use get_staff_welfare_fund_status for welfare fund balance and history.",
    "",
    "Access vs missing features: If the user asks about workspace data you cannot retrieve because no matching tool appears in YOUR list above, do NOT say you lack the capability, do not have a tool, or that the feature is coming soon. Other staff roles may have assistant tools for that data. Explain briefly that the information is not available to their current role, name the relevant Dashboard module when you can infer it (Finance, Operations, Inventory, Sales & CRM, HR Management, Real Estate, Administration), and suggest they check with an administrator about module access if they need it. Stay polite; keep it short.",
    "",
    "Genuinely unavailable (not role-gated): get_returns_summary and get_workspace_settings_summary are not implemented for any role yet — only mention these if asked specifically about returns/credit notes or workspace settings completeness.",
    "",
    "Fixed asset purchases: Finance → Fixed Assets only (no duplicate Expense Register row). Expense Register create form does not offer Fixed Assets category.",
    "",
    "PAYE/SSNIT/casual: platform statutory tables by effective date (Act 1178 bands from Sept 2026). Explain payroll lock banner when rates missing for the period.",
    "",
    "Supplier replacement driver/service: Finance → Supplier Contracts → open contract → Record replacement payment (date, name, amount, payment method, notes); reduces that month's AP; credit may carry forward.",
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
