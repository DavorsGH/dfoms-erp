import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchContractProfitabilityReportData } from "@/app/dashboard/reports/finance-report-data";
import type { ProjectEntry } from "@/app/dashboard/administration/projects-utils";
import {
  buildContractProfitabilityReport,
  type ContractProfitabilityServiceContract,
  type ContractProfitabilityTableRow,
  type OverheadAllocationMode,
} from "@/app/dashboard/reports/contract-profitability-utils";
import { monthIndexFromMonthNumber } from "@/app/dashboard/reports/finance-reports-utils";
import { fetchBalanceSheetPageData } from "@/app/dashboard/finance/balance-sheet-page-data";
import {
  buildInterUnitPairSummaries,
  BUSINESS_UNIT_TRANSFER_SELECT,
  interUnitTransferScopeFromReadScope,
  normalizeBusinessUnitTransferRecord,
  type BusinessUnitTransferRecord,
} from "@/app/dashboard/finance/business-unit-transfers-utils";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { getBalanceSheetAmountForMonth } from "@/app/dashboard/finance/balance-sheet-utils";
import { buildStandardBalanceSheetReport } from "@/lib/finance/balance-sheet-standard-report";
import { isExpenseRegisterPayrollLabourCategory } from "@/app/dashboard/finance/expense-register-bulk-project-utils";
import { isAccountsPayableAccrualExpenseReceiptNo } from "@/app/dashboard/finance/accounts-payable-accrual-utils";
import {
  getEntryMonthIndex,
  getTaxExclusiveExpenseAmount,
  shouldIncludeExpenseInProfitLoss,
} from "@/app/dashboard/finance/profit-loss-utils";
import { PROJECT_SELECT, normalizeProjectEntry } from "@/app/dashboard/administration/projects-utils";
import { SUPPLIER_CONTRACT_LIST_SELECT } from "@/utils/supplier-contracts-types";
import { canAccessFinanceSection } from "@/utils/rbac-access";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";
import { roundAssistantAmount } from "@/utils/assistant-tool-format";
import {
  parseAssistantYearMonth,
  todayAccraCalendarMonth,
} from "@/utils/assistant-period-resolve";

function parseYearMonth(toolInput: unknown): { year: number; month: number } {
  const { year, month } = parseAssistantYearMonth(toolInput);
  return { year, month };
}

function parseAllocationMode(toolInput: unknown): OverheadAllocationMode {
  if (!toolInput || typeof toolInput !== "object") {
    return "none";
  }
  const raw = String((toolInput as Record<string, unknown>).allocationMode ?? "")
    .trim()
    .toLowerCase();
  if (raw === "revenue" || raw === "revenue share" || raw === "revenue_share") {
    return "revenue";
  }
  if (raw === "headcount") {
    return "headcount";
  }
  return "none";
}

function parseOptionalStringField(
  toolInput: unknown,
  field: string,
): string | null {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  const value = (toolInput as Record<string, unknown>)[field];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeNameFilter(value: string): string {
  return value.trim().toLowerCase();
}

function buildContractRowSearchTerms(
  row: ContractProfitabilityTableRow,
  projects: ProjectEntry[],
  serviceContracts: ContractProfitabilityServiceContract[],
): string[] {
  const terms: string[] = [row.label, ...row.siteLabels];

  if (row.rowKey.startsWith("project:")) {
    const projectId = row.rowKey.slice("project:".length);
    const project = projects.find((entry) => entry.id === projectId);
    if (project) {
      terms.push(project.project_code, project.project_name);
      for (const site of project.sites ?? []) {
        terms.push(site.site_code, site.site_name);
        const clientName = site.client?.client_name;
        if (clientName) {
          terms.push(clientName);
        }
      }
    }
  } else if (row.rowKey.startsWith("contract:")) {
    const contractId = row.rowKey.slice("contract:".length);
    const contract = serviceContracts.find((entry) => entry.id === contractId);
    if (contract) {
      terms.push(contract.contract_number, contract.client_name);
    }
    for (const project of projects.filter(
      (entry) => entry.service_contract_id === contractId,
    )) {
      terms.push(project.project_code, project.project_name);
      for (const site of project.sites ?? []) {
        terms.push(site.site_code, site.site_name);
        const clientName = site.client?.client_name;
        if (clientName) {
          terms.push(clientName);
        }
      }
    }
  }

  return terms
    .map((term) => term.trim())
    .filter(Boolean);
}

function contractRowMatchesNameFilter(
  row: ContractProfitabilityTableRow,
  nameFilter: string,
  projects: ProjectEntry[],
  serviceContracts: ContractProfitabilityServiceContract[],
): boolean {
  const query = normalizeNameFilter(nameFilter);
  if (!query) {
    return true;
  }

  const haystacks = buildContractRowSearchTerms(
    row,
    projects,
    serviceContracts,
  ).map((term) => normalizeNameFilter(term));

  if (haystacks.some((haystack) => haystack.includes(query))) {
    return true;
  }

  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const combined = haystacks.join(" ");
    if (tokens.every((token) => combined.includes(token))) {
      return true;
    }
  }

  return false;
}

function listAvailableContractOrProjectNames(
  rows: ContractProfitabilityTableRow[],
): string[] {
  return [...new Set(rows.map((row) => row.label.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function mapContractRow(row: ContractProfitabilityTableRow) {
  return {
    rowKey: row.rowKey,
    kind: row.kind,
    label: row.label,
    revenueGhs: roundAssistantAmount(row.revenue),
    labourGhs: roundAssistantAmount(row.labour),
    directCostsGhs: roundAssistantAmount(row.directCosts),
    overheadAllocatedGhs: roundAssistantAmount(row.overheadShare),
    marginGhs: roundAssistantAmount(row.netMargin),
    marginPercent: row.netMarginPct,
    labourIsEstimated: row.labourIsEstimated ?? false,
    marginsAreEstimated: row.marginsAreEstimated ?? false,
  };
}

export function buildAssistantContractProfitabilitySummary(
  loaderData: Awaited<ReturnType<typeof fetchContractProfitabilityReportData>>,
  options: {
    year: number;
    month: number;
    allocationMode: OverheadAllocationMode;
    nameFilter: string | null;
  },
) {
  const monthIndex = monthIndexFromMonthNumber(options.month);
  const invoiceMap = new Map(Object.entries(loaderData.invoiceContractById));

  const report = buildContractProfitabilityReport({
    financialYear: options.year,
    monthIndex,
    allocationMode: options.allocationMode,
    incomeEntries: loaderData.initialIncomeEntries,
    expenseEntries: loaderData.initialExpenseEntries,
    fixedAssets: loaderData.initialFixedAssets,
    invoiceContractById: invoiceMap,
    serviceContracts: loaderData.initialServiceContracts,
    projects: loaderData.initialProjects,
    payrollRows: loaderData.initialPayrollRows,
    payrollProcessingRows: loaderData.initialPayrollProcessingRows,
    tenantHasServiceContracts: loaderData.tenantHasServiceContracts,
  });

  const contractRows = report.rows.filter((row) => row.kind === "contract");
  let rows = contractRows;
  const projects = loaderData.initialProjects as ProjectEntry[];
  const serviceContracts =
    loaderData.initialServiceContracts as ContractProfitabilityServiceContract[];

  if (options.nameFilter) {
    const matched = contractRows.filter((row) =>
      contractRowMatchesNameFilter(
        row,
        options.nameFilter!,
        projects,
        serviceContracts,
      ),
    );
    if (matched.length === 0) {
      const availableContractOrProjectNames = listAvailableContractOrProjectNames(
        contractRows,
      ).slice(0, LIST_LIMIT);
      return {
        error: `No contract or project matching "${options.nameFilter}" in this workspace.`,
        nameFilter: options.nameFilter,
        availableContractOrProjectNames,
        didYouMeanHint:
          availableContractOrProjectNames.length > 0
            ? "Ask the user if they meant one of the availableContractOrProjectNames."
            : null,
      };
    }
    rows = matched;
  }

  const companyRow = report.rows.find((row) => row.kind === "company_total");

  return {
    periodLabel: `${options.year}-${String(options.month).padStart(2, "0")}`,
    year: options.year,
    month: options.month,
    allocationMode: options.allocationMode,
    nameFilter: options.nameFilter,
    rows: rows.map(mapContractRow),
    overheadRow: report.rows.find((row) => row.kind === "overhead")
      ? mapContractRow(report.rows.find((row) => row.kind === "overhead")!)
      : null,
    unallocatedRevenueRow: report.rows.find((row) => row.kind === "unallocated_revenue")
      ? mapContractRow(report.rows.find((row) => row.kind === "unallocated_revenue")!)
      : null,
    companyTotal: companyRow ? mapContractRow(companyRow) : null,
    reconciliation: {
      companyRevenueGhs: roundAssistantAmount(report.reconciliation.companyRevenue),
      companyNetProfitGhs: roundAssistantAmount(report.reconciliation.companyNetProfit),
      tableRevenueGhs: roundAssistantAmount(report.reconciliation.tableRevenue),
      tableNetProfitGhs: roundAssistantAmount(report.reconciliation.tableNetProfit),
      estimatedPayrollNotInPlGhs: roundAssistantAmount(
        report.reconciliation.estimatedPayrollNotInPl,
      ),
      revenueDifferenceGhs: roundAssistantAmount(report.reconciliation.revenueDifference),
      netProfitDifferenceGhs: roundAssistantAmount(
        report.reconciliation.netProfitDifference,
      ),
      matchesCompanyPl: report.reconciliation.matchesCompanyPl,
    },
    warnings: {
      payrollNotPostedMessage: report.payrollNotPostedMessage,
      voidedIncomeCount: report.warnings.voidedIncomeCount,
      voidedIncomeTotalGhs: roundAssistantAmount(report.warnings.voidedIncomeTotal),
      expensesWithoutProjectCount: report.warnings.expensesWithoutProjectCount,
      expensesWithoutProjectTotalGhs: roundAssistantAmount(
        report.warnings.expensesWithoutProjectTotal,
      ),
      payrollEmployeesWithoutProjectCount:
        report.warnings.payrollEmployeesWithoutProjectCount,
      allocationFallbackNote: report.warnings.allocationFallbackNote,
      payrollDetailExceedsPostedNote: report.warnings.payrollDetailExceedsPostedNote,
    },
    fetchWarning: loaderData.fetchError,
  };
}

export async function getContractProfitabilitySummary(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to Contract Profitability data." };
  }

  const { year, month } = parseYearMonth(toolInput);
  const allocationMode = parseAllocationMode(toolInput);
  const nameFilter = parseOptionalStringField(toolInput, "contractOrProjectName");

  try {
    const supabase = await getStaffSupabase();
    const data = await fetchContractProfitabilityReportData(supabase);
    return buildAssistantContractProfitabilitySummary(data, {
      year,
      month,
      allocationMode,
      nameFilter,
    });
  } catch (error) {
    console.error("[assistant] get_contract_profitability_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function buildAssistantCostTaggingHealth(
  supabase: SupabaseClient,
  tenantId: string,
  year: number,
  month: number,
) {
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const monthIndex = monthIndexFromMonthNumber(month);

  const expenseSelect =
    "id, date, receipt_no, vendor, amount, expense_category, project_id, net_of_tax_amount";

  const [expensesResult, payablesResult, contractsResult, projectsResult] =
    await Promise.all([
      applyBusinessUnitScope(
        supabase
          .from("expense_register")
          .select(expenseSelect)
          .eq("tenant_id", tenantId),
        buScope,
      ),
      applyBusinessUnitScope(
        supabase
          .from("accounts_payable")
          .select("id, invoice_date, invoice_number, vendor_name, amount, project_id")
          .eq("tenant_id", tenantId),
        buScope,
      ),
      applyBusinessUnitScope(
        supabase
          .from("supplier_contracts")
          .select(`${SUPPLIER_CONTRACT_LIST_SELECT}, project_id`)
          .eq("tenant_id", tenantId),
        buScope,
      ),
      applyBusinessUnitScope(
        supabase
          .from("projects")
          .select(PROJECT_SELECT)
          .eq("tenant_id", tenantId)
          .order("project_code", { ascending: true }),
        buScope,
      ),
    ]);

  const fetchWarning =
    expensesResult.error?.message ??
    payablesResult.error?.message ??
    contractsResult.error?.message ??
    projectsResult.error?.message ??
    null;

  type ExpenseRow = {
    id: string;
    date: string;
    receipt_no: string | null;
    vendor: string | null;
    amount: number;
    expense_category: string | null;
    project_id: string | null;
  };

  const untaggedExpenses: Array<{
    date: string;
    reference: string;
    vendor: string;
    amountGhs: number;
  }> = [];

  let untaggedExpenseCount = 0;
  let untaggedExpenseTotal = 0;

  for (const row of (expensesResult.data as ExpenseRow[] | null) ?? []) {
    if (isExpenseRegisterPayrollLabourCategory(row.expense_category)) {
      continue;
    }
    if (isAccountsPayableAccrualExpenseReceiptNo(row.receipt_no)) {
      continue;
    }
    if (!shouldIncludeExpenseInProfitLoss(row.expense_category, row)) {
      continue;
    }
    const idx = getEntryMonthIndex(row.date, year);
    if (idx !== monthIndex) {
      continue;
    }
    if (row.project_id?.trim()) {
      continue;
    }
    const amount = roundAssistantAmount(getTaxExclusiveExpenseAmount(row));
    untaggedExpenseCount += 1;
    untaggedExpenseTotal = roundAssistantAmount(untaggedExpenseTotal + amount);
    untaggedExpenses.push({
      date: row.date.slice(0, 10),
      reference: row.receipt_no?.trim() || "—",
      vendor: row.vendor?.trim() || "—",
      amountGhs: amount,
    });
  }

  untaggedExpenses.sort((left, right) => right.amountGhs - left.amountGhs);

  type PayableRow = {
    id: string;
    invoice_date: string | null;
    invoice_number: string | null;
    vendor_name: string | null;
    amount: number;
    project_id: string | null;
  };

  let untaggedPayableCount = 0;
  let untaggedPayableTotal = 0;
  const untaggedPayables: typeof untaggedExpenses = [];

  for (const row of (payablesResult.data as PayableRow[] | null) ?? []) {
    if (row.project_id?.trim()) {
      continue;
    }
    const date = row.invoice_date?.slice(0, 10) ?? "";
    if (!date) {
      continue;
    }
    const idx = getEntryMonthIndex(date, year);
    if (idx !== monthIndex) {
      continue;
    }
    const amount = roundAssistantAmount(Number(row.amount) || 0);
    untaggedPayableCount += 1;
    untaggedPayableTotal = roundAssistantAmount(untaggedPayableTotal + amount);
    untaggedPayables.push({
      date,
      reference: row.invoice_number?.trim() || "—",
      vendor: row.vendor_name?.trim() || "—",
      amountGhs: amount,
    });
  }

  untaggedPayables.sort((left, right) => right.amountGhs - left.amountGhs);

  let untaggedSupplierContractCount = 0;
  for (const row of (contractsResult.data as Array<{ project_id?: string | null }> | null) ??
    []) {
    if (!row.project_id?.trim()) {
      untaggedSupplierContractCount += 1;
    }
  }

  const projectsWithoutServiceContract = (
    (projectsResult.data ?? []).map(normalizeProjectEntry)
  )
    .filter(
      (project) =>
        !project.is_archived && !project.service_contract_id?.trim(),
    )
    .slice(0, LIST_LIMIT)
    .map((project) => ({
      projectCode: project.project_code,
      projectName: project.project_name,
    }));

  const topUntagged = [...untaggedExpenses, ...untaggedPayables]
    .sort((left, right) => right.amountGhs - left.amountGhs)
    .slice(0, 5);

  return {
    periodLabel: `${year}-${String(month).padStart(2, "0")}`,
    year,
    month,
    untaggedExpenses: {
      count: untaggedExpenseCount,
      totalGhs: roundAssistantAmount(untaggedExpenseTotal),
    },
    untaggedAccountsPayable: {
      count: untaggedPayableCount,
      totalGhs: roundAssistantAmount(untaggedPayableTotal),
    },
    untaggedSupplierContracts: { count: untaggedSupplierContractCount },
    topUntaggedByAmount: topUntagged,
    projectsWithoutServiceContract,
    note:
      "Expense rows with no project_id include intentional Company overhead (stored as null) — treat null project_id as untagged for this health check unless you use bulk re-tag or single-row project assignment. AP-ACCRUAL-* expense rows are excluded (same bill is counted under Accounts Payable).",
    projectsWithoutServiceContractGuidance:
      "Internal/overhead projects (e.g. your office) are expected to have no contract — ignore those.",
    fetchWarning,
  };
}

export async function getCostTaggingHealth(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to cost tagging data." };
  }

  const { year, month } = parseYearMonth(toolInput);

  try {
    const supabase = await getStaffSupabase();
    return buildAssistantCostTaggingHealth(
      supabase,
      sessionResult.session.tenantId,
      year,
      month,
    );
  } catch (error) {
    console.error("[assistant] get_cost_tagging_health threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function loadInterUnitBalanceLinesForAssistant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{
  dueFromOtherBusinessUnitsGhs: number | null;
  dueToOtherBusinessUnitsGhs: number | null;
  asOfPeriodLabel: string;
}> {
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const { year, month } = todayAccraCalendarMonth();
  const monthIndex = month - 1;

  const pageData = await fetchBalanceSheetPageData(supabase, tenantId, {
    activeBusinessUnitId,
    viewAllBusinessUnits,
  });

  const report = buildStandardBalanceSheetReport(pageData, tenantId, year, {
    allBusinessUnitsDirectorsLoan: buScope.mode === "all",
    interUnitTransferScope: interUnitTransferScopeFromReadScope(buScope),
  });

  const dueFromRow = report.rows.find(
    (row) => row.key === "due-from-other-business-units",
  );
  const dueToRow = report.rows.find(
    (row) => row.key === "due-to-other-business-units",
  );

  return {
    asOfPeriodLabel: `${year}-${String(month).padStart(2, "0")}`,
    dueFromOtherBusinessUnitsGhs: dueFromRow
      ? roundAssistantAmount(getBalanceSheetAmountForMonth(dueFromRow, monthIndex))
      : null,
    dueToOtherBusinessUnitsGhs: dueToRow
      ? roundAssistantAmount(getBalanceSheetAmountForMonth(dueToRow, monthIndex))
      : null,
  };
}

function parseDateRange(toolInput: unknown): { from: string | null; to: string | null } {
  const from = parseOptionalStringField(toolInput, "fromDate");
  const to = parseOptionalStringField(toolInput, "toDate");
  return { from, to };
}

function parseLimit(toolInput: unknown): number {
  if (!toolInput || typeof toolInput !== "object") {
    return LIST_LIMIT;
  }
  const limit = (toolInput as Record<string, unknown>).limit;
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return LIST_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), LIST_LIMIT);
}

export async function getInterUnitTransfers(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to inter-unit transfer data." };
  }

  const { from, to } = parseDateRange(toolInput);
  const limit = parseLimit(toolInput);

  try {
    const supabase = await getStaffSupabase();
    const tenantId = sessionResult.session.tenantId;

    const [{ data: units, error: unitsError }, { data: transfersRaw, error: transfersError }] =
      await Promise.all([
        supabase
          .from("business_units")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .order("name", { ascending: true }),
        supabase
          .from("business_unit_transfers")
          .select(BUSINESS_UNIT_TRANSFER_SELECT)
          .eq("tenant_id", tenantId)
          .order("transfer_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

    if (unitsError || transfersError) {
      console.error(
        "[assistant] get_inter_unit_transfers failed:",
        unitsError?.message ?? transfersError?.message,
      );
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const unitNameById = new Map(
      (units ?? []).map((row) => [String(row.id), String(row.name ?? row.id)]),
    );

    let transfers = ((transfersRaw as BusinessUnitTransferRecord[] | null) ?? []).map(
      normalizeBusinessUnitTransferRecord,
    );

    if (from) {
      transfers = transfers.filter((row) => row.transfer_date.slice(0, 10) >= from);
    }
    if (to) {
      transfers = transfers.filter((row) => row.transfer_date.slice(0, 10) <= to);
    }

    const asOfDate = to ?? new Date().toISOString().slice(0, 10);
    const pairSummaries = buildInterUnitPairSummaries(
      transfers,
      unitNameById,
      asOfDate,
    ).map((summary) => ({
      debtorUnitId: summary.debtorUnitId,
      creditorUnitId: summary.creditorUnitId,
      amountGhs: roundAssistantAmount(summary.amount),
      label: `${summary.label} ${formatGHS(summary.amount)}`,
    }));

    const transferRows = transfers.slice(0, limit).map((row) => ({
      date: row.transfer_date.slice(0, 10),
      fromUnit: unitNameById.get(row.from_business_unit_id) ?? row.from_business_unit_id,
      toUnit: unitNameById.get(row.to_business_unit_id) ?? row.to_business_unit_id,
      amountGhs: roundAssistantAmount(row.amount),
      description: row.description,
      reference: row.reference,
    }));

    return {
      transferCount: transfers.length,
      transfers: transferRows,
      netPositions: pairSummaries,
      asOfDate,
    };
  } catch (error) {
    console.error("[assistant] get_inter_unit_transfers threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
