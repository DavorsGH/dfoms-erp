import {
  PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
  PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
} from "../hr-payroll/payroll-lock-finance-utils";
import {
  buildPeriodKey,
  getPeriodEndDate,
  payrollMonthToPeriodKey,
} from "../hr-payroll/payroll-period-utils";
import type { ProjectEntry } from "../administration/projects-utils";
import {
  isActiveIncomeForReporting,
  isVoidedClientInvoiceIncome,
  isVoidedProductSale,
} from "../finance/income-register-utils";
import {
  shouldIncludeExpenseInProfitLoss,
} from "../finance/profit-loss-utils";
import { calculateMonthlyDepreciationTotals } from "../finance/fixed-assets-utils";
import {
  buildProfitLossReport,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  getTaxExclusiveExpenseAmount,
  getTaxExclusiveRevenueAmount,
  normalizeCategoryName,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "../finance/profit-loss-utils";

export type OverheadAllocationMode = "none" | "revenue" | "headcount";

export type ContractProfitabilityIncomeRow = ProfitLossIncomeEntry & {
  id: string;
  client_invoice_id?: string | null;
  payment_status?: string | null;
};

export type ContractProfitabilityExpenseRow = ProfitLossExpenseEntry & {
  project_id?: string | null;
};

export type ContractProfitabilityPayrollRow = {
  employee_id: string;
  payroll_month: string;
  project_contract: string | null;
  gross_pay: number;
  employer_ssnit: number;
  tier2: number;
};

export type ContractProfitabilityServiceContract = {
  id: string;
  contract_number: string;
  client_name: string;
};

export type ContractProfitabilityBuildInput = {
  financialYear: number;
  monthIndex: number;
  allocationMode: OverheadAllocationMode;
  incomeEntries: ContractProfitabilityIncomeRow[];
  expenseEntries: ContractProfitabilityExpenseRow[];
  fixedAssets: ProfitLossAssetEntry[];
  invoiceContractById: Map<string, string | null>;
  serviceContracts: ContractProfitabilityServiceContract[];
  projects: ProjectEntry[];
  payrollRows: ContractProfitabilityPayrollRow[];
  payrollProcessingRows: ContractProfitabilityPayrollRow[];
  tenantHasServiceContracts: boolean;
};

export type ContractProfitabilityTableRow = {
  rowKey: string;
  kind: "contract" | "unallocated_revenue" | "overhead" | "company_total";
  label: string;
  siteLabels: string[];
  revenue: number;
  labour: number;
  directCosts: number;
  grossMargin: number;
  grossMarginPct: number | null;
  overheadShare: number;
  netMargin: number;
  netMarginPct: number | null;
  labourIsEstimated?: boolean;
  marginsAreEstimated?: boolean;
  netMarginIncludingEstimatedPayroll?: number;
  netMarginIncludingEstimatedPayrollPct?: number | null;
};

export type ContractProfitabilityWarnings = {
  voidedIncomeCount: number;
  voidedIncomeTotal: number;
  expensesWithoutProjectCount: number;
  expensesWithoutProjectTotal: number;
  payrollEmployeesWithoutProjectCount: number;
  payrollEmployeesWithoutProjectLabour: number;
  allocationFallbackNote: string | null;
  payrollDetailExceedsPostedNote: string | null;
};

export type ContractProfitabilityReconciliation = {
  companyRevenue: number;
  companyTotalExpenses: number;
  companyNetProfit: number;
  tableRevenue: number;
  tableTotalCosts: number;
  tableNetProfit: number;
  estimatedPayrollNotInPl: number;
  revenueDifference: number;
  netProfitDifference: number;
  matchesCompanyPl: boolean;
};

export type ContractProfitabilityReport = {
  rows: ContractProfitabilityTableRow[];
  warnings: ContractProfitabilityWarnings;
  reconciliation: ContractProfitabilityReconciliation;
  payrollNotPostedMessage: string | null;
  isEmpty: boolean;
};

const ROUND_TOLERANCE = 0.01;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function marginPct(margin: number, revenue: number): number | null {
  if (revenue <= 0) {
    return null;
  }
  return margin / revenue;
}

function isPayrollExpenseCategory(expenseCategory: string | null | undefined): boolean {
  const normalized = normalizeCategoryName(expenseCategory ?? "");
  return (
    normalized === normalizeCategoryName(PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES) ||
    normalized === normalizeCategoryName(PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT)
  );
}

function payrollLabourComponent(row: ContractProfitabilityPayrollRow): number {
  return (
    (Number(row.gross_pay) || 0) +
    (Number(row.employer_ssnit) || 0) +
    (Number(row.tier2) || 0)
  );
}

/**
 * Payroll lock posts Staff Salaries / Employer SSNIT to expense_register with
 * date = getPeriodEndDate(payroll year, payroll month). P&L buckets those rows
 * by getEntryMonthIndex(date, financialYear), i.e. the same calendar month as
 * payroll_month (YYYY-MM-01 → period key YYYY-MM). Employee splits use
 * payroll_history plus open-month payroll_processing rows merged the same way
 * as payroll-live-recalc (history month wins; processing skipped when any
 * history row exists for that payroll_month).
 */
export function mergeContractProfitabilityPayrollRows(
  historyRows: ContractProfitabilityPayrollRow[],
  processingRows: ContractProfitabilityPayrollRow[],
): ContractProfitabilityPayrollRow[] {
  const historyMonths = new Set(
    historyRows.map((row) => row.payroll_month.slice(0, 10)),
  );
  const openProcessing = processingRows.filter(
    (row) => !historyMonths.has(row.payroll_month.slice(0, 10)),
  );
  return [...historyRows, ...openProcessing];
}

export function payrollRowsForCalendarMonth(
  rows: ContractProfitabilityPayrollRow[],
  financialYear: number,
  monthIndex: number,
): ContractProfitabilityPayrollRow[] {
  if (monthIndex === FULL_YEAR_INDEX) {
    return rows.filter((row) => {
      const key = payrollMonthToPeriodKey(row.payroll_month);
      if (!key) {
        return false;
      }
      const year = Number(key.slice(0, 4));
      return year === financialYear;
    });
  }

  const monthNumber = monthIndex + 1;
  const periodKey = buildPeriodKey(financialYear, monthNumber);
  void getPeriodEndDate(financialYear, monthNumber);
  return rows.filter(
    (row) => payrollMonthToPeriodKey(row.payroll_month) === periodKey,
  );
}

function entryMatchesReportMonth(
  entryMonthIndex: number | null,
  reportMonthIndex: number,
): boolean {
  if (entryMonthIndex === null) {
    return false;
  }
  if (reportMonthIndex === FULL_YEAR_INDEX) {
    return entryMonthIndex >= 0 && entryMonthIndex <= 11;
  }
  return entryMonthIndex === reportMonthIndex;
}

function formatCalendarMonthLabel(financialYear: number, monthIndex: number): string {
  return new Date(financialYear, monthIndex, 1).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function payrollProcessingExistsForMonth(
  payrollProcessingRows: ContractProfitabilityPayrollRow[],
  financialYear: number,
  monthIndex: number,
): boolean {
  const periodKey = buildPeriodKey(financialYear, monthIndex + 1);
  return payrollProcessingRows.some(
    (row) => payrollMonthToPeriodKey(row.payroll_month) === periodKey,
  );
}

function isPayrollNotPostedForMonth(
  expenseEntries: ContractProfitabilityExpenseRow[],
  payrollProcessingRows: ContractProfitabilityPayrollRow[],
  financialYear: number,
  monthIndex: number,
): boolean {
  const official = officialPayrollCostForPeriod(
    expenseEntries,
    financialYear,
    monthIndex,
  );
  if (official.total > ROUND_TOLERANCE) {
    return false;
  }
  return payrollProcessingExistsForMonth(
    payrollProcessingRows,
    financialYear,
    monthIndex,
  );
}

type PayrollLabourSplitForMonth = {
  labourByKey: Map<string, number>;
  unallocatedLabour: number;
  estimatedPayrollTotal: number;
  isPayrollNotPosted: boolean;
  payrollEmployeesWithoutProjectCount: number;
  payrollEmployeesWithoutProjectLabour: number;
  payrollScaleWarning: string | null;
};

function computePayrollLabourForMonth(
  monthIndex: number,
  input: Pick<
    ContractProfitabilityBuildInput,
    | "expenseEntries"
    | "financialYear"
    | "payrollRows"
    | "payrollProcessingRows"
    | "projects"
    | "tenantHasServiceContracts"
  >,
  contractKeys: Set<string>,
): PayrollLabourSplitForMonth {
  const {
    expenseEntries,
    financialYear,
    payrollRows,
    payrollProcessingRows,
    projects,
    tenantHasServiceContracts,
  } = input;

  const labourByKey = new Map<string, number>();
  let payrollEmployeesWithoutProjectCount = 0;
  let payrollEmployeesWithoutProjectLabour = 0;
  let contractLabourRaw = 0;
  let totalPayrollDetail = 0;

  const payrollForMonth = payrollRowsForCalendarMonth(
    payrollRows,
    financialYear,
    monthIndex,
  );

  for (const row of payrollForMonth) {
    const component = payrollLabourComponent(row);
    totalPayrollDetail += component;
    const contractKey = resolveProjectCodeToContractKey(
      row.project_contract,
      projects,
      tenantHasServiceContracts,
    );
    if (contractKey && contractKeys.has(contractKey)) {
      labourByKey.set(
        contractKey,
        roundCurrency((labourByKey.get(contractKey) ?? 0) + component),
      );
      contractLabourRaw += component;
    } else if (!row.project_contract?.trim()) {
      payrollEmployeesWithoutProjectCount += 1;
      payrollEmployeesWithoutProjectLabour += component;
    }
  }

  totalPayrollDetail = roundCurrency(totalPayrollDetail);
  contractLabourRaw = roundCurrency(contractLabourRaw);

  const official = officialPayrollCostForPeriod(
    expenseEntries,
    financialYear,
    monthIndex,
  );
  const isPayrollNotPosted = isPayrollNotPostedForMonth(
    expenseEntries,
    payrollProcessingRows,
    financialYear,
    monthIndex,
  );

  if (isPayrollNotPosted) {
    return {
      labourByKey,
      unallocatedLabour: 0,
      estimatedPayrollTotal: totalPayrollDetail,
      isPayrollNotPosted: true,
      payrollEmployeesWithoutProjectCount,
      payrollEmployeesWithoutProjectLabour: roundCurrency(
        payrollEmployeesWithoutProjectLabour,
      ),
      payrollScaleWarning: null,
    };
  }

  let payrollScaleWarning: string | null = null;
  let unallocatedLabour = roundCurrency(
    Math.max(0, official.total - contractLabourRaw),
  );

  if (
    contractLabourRaw > official.total + ROUND_TOLERANCE &&
    official.total > ROUND_TOLERANCE
  ) {
    const scale = official.total / contractLabourRaw;
    for (const [key, amount] of labourByKey) {
      labourByKey.set(key, roundCurrency(amount * scale));
    }
    contractLabourRaw = official.total;
    unallocatedLabour = 0;
    payrollScaleWarning = `Payroll detail (${formatCurrencyForWarning(totalPayrollDetail)}) exceeds posted payroll (${formatCurrencyForWarning(official.total)}) for ${formatCalendarMonthLabel(financialYear, monthIndex)} — contract labour scaled to match the P&L.`;
  } else if (unallocatedLabour < 0) {
    unallocatedLabour = 0;
  }

  return {
    labourByKey,
    unallocatedLabour,
    estimatedPayrollTotal: 0,
    isPayrollNotPosted: false,
    payrollEmployeesWithoutProjectCount,
    payrollEmployeesWithoutProjectLabour: roundCurrency(
      payrollEmployeesWithoutProjectLabour,
    ),
    payrollScaleWarning,
  };
}

function formatCurrencyForWarning(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

function aggregatePayrollLabourForReport(
  reportMonthIndex: number,
  input: ContractProfitabilityBuildInput,
  contractKeys: Set<string>,
): {
  labourByKey: Map<string, number>;
  unallocatedLabour: number;
  estimatedPayrollTotal: number;
  payrollNotPostedLabels: string[];
  payrollEmployeesWithoutProjectCount: number;
  payrollEmployeesWithoutProjectLabour: number;
  payrollScaleWarnings: string[];
  postedPayrollTotal: number;
} {
  const monthIndexes =
    reportMonthIndex === FULL_YEAR_INDEX
      ? Array.from({ length: 12 }, (_, index) => index)
      : [reportMonthIndex];

  const labourByKey = new Map<string, number>();
  let unallocatedLabour = 0;
  let estimatedPayrollTotal = 0;
  const payrollNotPostedLabels: string[] = [];
  const payrollScaleWarnings: string[] = [];
  let payrollEmployeesWithoutProjectCount = 0;
  let payrollEmployeesWithoutProjectLabour = 0;
  let postedPayrollTotal = 0;

  for (const monthIdx of monthIndexes) {
    const split = computePayrollLabourForMonth(monthIdx, input, contractKeys);
    postedPayrollTotal = roundCurrency(
      postedPayrollTotal +
        officialPayrollCostForPeriod(
          input.expenseEntries,
          input.financialYear,
          monthIdx,
        ).total,
    );
    unallocatedLabour = roundCurrency(unallocatedLabour + split.unallocatedLabour);
    estimatedPayrollTotal = roundCurrency(
      estimatedPayrollTotal + split.estimatedPayrollTotal,
    );
    payrollEmployeesWithoutProjectCount += split.payrollEmployeesWithoutProjectCount;
    payrollEmployeesWithoutProjectLabour = roundCurrency(
      payrollEmployeesWithoutProjectLabour +
        split.payrollEmployeesWithoutProjectLabour,
    );
    if (split.payrollScaleWarning) {
      payrollScaleWarnings.push(split.payrollScaleWarning);
    }
    if (split.isPayrollNotPosted) {
      payrollNotPostedLabels.push(
        formatCalendarMonthLabel(input.financialYear, monthIdx),
      );
    }
    for (const [key, amount] of split.labourByKey) {
      labourByKey.set(key, roundCurrency((labourByKey.get(key) ?? 0) + amount));
    }
  }

  return {
    labourByKey,
    unallocatedLabour,
    estimatedPayrollTotal,
    payrollNotPostedLabels,
    payrollEmployeesWithoutProjectCount,
    payrollEmployeesWithoutProjectLabour,
    payrollScaleWarnings,
    postedPayrollTotal,
  };
}

function officialPayrollCostForPeriod(
  expenseEntries: ContractProfitabilityExpenseRow[],
  financialYear: number,
  monthIndex: number,
): { staffSalaries: number; employerSsnit: number; total: number } {
  let staffSalaries = 0;
  let employerSsnit = 0;

  for (const entry of expenseEntries) {
    if (!shouldIncludeExpenseInProfitLoss(entry.expense_category, entry)) {
      continue;
    }
    const idx = getEntryMonthIndex(entry.date, financialYear);
    if (!entryMatchesReportMonth(idx, monthIndex)) {
      continue;
    }
    const amount = getTaxExclusiveExpenseAmount(entry);
    const normalized = normalizeCategoryName(entry.expense_category ?? "");
    if (normalized === normalizeCategoryName(PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES)) {
      staffSalaries += amount;
    } else if (
      normalized === normalizeCategoryName(PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT)
    ) {
      employerSsnit += amount;
    }
  }

  return {
    staffSalaries: roundCurrency(staffSalaries),
    employerSsnit: roundCurrency(employerSsnit),
    total: roundCurrency(staffSalaries + employerSsnit),
  };
}

function depreciationForPeriod(
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
  monthIndex: number,
): number {
  const totals = calculateMonthlyDepreciationTotals(fixedAssets, financialYear);
  const index =
    monthIndex === FULL_YEAR_INDEX ? FULL_YEAR_INDEX : monthIndex;
  return roundCurrency(totals[index] ?? 0);
}

type ContractKeyDef = {
  key: string;
  contractId: string | null;
  projectId: string | null;
  label: string;
  siteLabels: string[];
};

function buildContractKeyDefs(input: ContractProfitabilityBuildInput): ContractKeyDef[] {
  const { serviceContracts, projects, tenantHasServiceContracts } = input;

  if (!tenantHasServiceContracts) {
    return projects.map((project) => ({
      key: `project:${project.id}`,
      contractId: null,
      projectId: project.id,
      label: `${project.project_code} — ${project.project_name}`,
      siteLabels: (project.sites ?? []).map(
        (site) => `${site.site_code} — ${site.site_name}`,
      ),
    }));
  }

  return serviceContracts.map((contract) => {
    const contractProjects = projects.filter(
      (project) => project.service_contract_id === contract.id,
    );
    const siteLabels = contractProjects.flatMap((project) =>
      (project.sites ?? []).map(
        (site) => `${site.site_code} — ${site.site_name}`,
      ),
    );
    return {
      key: `contract:${contract.id}`,
      contractId: contract.id,
      projectId: null,
      label: `${contract.contract_number} — ${contract.client_name}`,
      siteLabels,
    };
  });
}

function resolveProjectIdToContractKey(
  projectId: string | null | undefined,
  projects: ProjectEntry[],
  tenantHasServiceContracts: boolean,
): string | null {
  const id = projectId?.trim();
  if (!id) {
    return null;
  }
  const project = projects.find((entry) => entry.id === id);
  if (!project) {
    return null;
  }
  if (!tenantHasServiceContracts) {
    return `project:${project.id}`;
  }
  const contractId = project.service_contract_id?.trim();
  if (!contractId) {
    return null;
  }
  return `contract:${contractId}`;
}

function resolveProjectCodeToContractKey(
  projectCode: string | null | undefined,
  projects: ProjectEntry[],
  tenantHasServiceContracts: boolean,
): string | null {
  const code = projectCode?.trim();
  if (!code) {
    return null;
  }
  const project = projects.find((entry) => entry.project_code === code);
  if (!project) {
    return null;
  }
  return resolveProjectIdToContractKey(project.id, projects, tenantHasServiceContracts);
}

function emptyContractTotals(): Map<string, { revenue: number; labour: number; direct: number }> {
  return new Map();
}

function getContractBucket(
  map: Map<string, { revenue: number; labour: number; direct: number }>,
  key: string,
): { revenue: number; labour: number; direct: number } {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created = { revenue: 0, labour: 0, direct: 0 };
  map.set(key, created);
  return created;
}

function extractCompanyPlTotals(
  incomeEntries: ProfitLossIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
  monthIndex: number,
): { revenue: number; totalExpenses: number; netProfit: number } {
  const report = buildProfitLossReport(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    financialYear,
  );
  const revenue =
    report.rows.find((row) => row.key === "total-revenue")?.amounts[monthIndex] ?? 0;
  const totalExpenses =
    report.rows.find((row) => row.key === "total-expenses")?.amounts[monthIndex] ?? 0;
  const netProfit =
    report.rows.find((row) => row.key === "net-profit")?.amounts[monthIndex] ?? 0;
  return {
    revenue: roundCurrency(revenue),
    totalExpenses: roundCurrency(totalExpenses),
    netProfit: roundCurrency(netProfit),
  };
}

export function buildContractProfitabilityReport(
  input: ContractProfitabilityBuildInput,
): ContractProfitabilityReport {
  const {
    financialYear,
    monthIndex,
    allocationMode,
    incomeEntries,
    expenseEntries,
    fixedAssets,
    invoiceContractById,
    projects,
    payrollRows,
    payrollProcessingRows,
    tenantHasServiceContracts,
  } = input;

  const contractDefs = buildContractKeyDefs(input);
  const contractKeys = new Set(contractDefs.map((def) => def.key));
  const totalsByKey = emptyContractTotals();

  let voidedIncomeCount = 0;
  let voidedIncomeTotal = 0;
  let unallocatedRevenue = 0;

  for (const entry of incomeEntries) {
    if (isVoidedProductSale(entry) || isVoidedClientInvoiceIncome(entry)) {
      voidedIncomeCount += 1;
      voidedIncomeTotal += getTaxExclusiveRevenueAmount(entry);
      continue;
    }
    if (!isActiveIncomeForReporting(entry)) {
      continue;
    }
    const idx = getEntryMonthIndex(entry.date, financialYear);
    if (!entryMatchesReportMonth(idx, monthIndex)) {
      continue;
    }

    const amount = getTaxExclusiveRevenueAmount(entry);
    const invoiceId = entry.client_invoice_id?.trim();
    const contractId = invoiceId
      ? invoiceContractById.get(invoiceId) ?? null
      : null;
    const contractKey =
      contractId && tenantHasServiceContracts
        ? `contract:${contractId}`
        : null;

    if (contractKey && contractKeys.has(contractKey)) {
      getContractBucket(totalsByKey, contractKey).revenue += amount;
    } else {
      unallocatedRevenue += amount;
    }
  }

  let expensesWithoutProjectCount = 0;
  let expensesWithoutProjectTotal = 0;
  let overheadCosts = 0;

  for (const entry of expenseEntries) {
    if (!shouldIncludeExpenseInProfitLoss(entry.expense_category, entry)) {
      continue;
    }
    if (isPayrollExpenseCategory(entry.expense_category)) {
      continue;
    }
    const idx = getEntryMonthIndex(entry.date, financialYear);
    if (!entryMatchesReportMonth(idx, monthIndex)) {
      continue;
    }
    const amount = getTaxExclusiveExpenseAmount(entry);
    const contractKey = resolveProjectIdToContractKey(
      entry.project_id,
      projects,
      tenantHasServiceContracts,
    );
    if (contractKey && contractKeys.has(contractKey)) {
      getContractBucket(totalsByKey, contractKey).direct += amount;
    } else {
      overheadCosts += amount;
      if (!entry.project_id?.trim()) {
        expensesWithoutProjectCount += 1;
        expensesWithoutProjectTotal += amount;
      }
    }
  }

  const payrollLabour = aggregatePayrollLabourForReport(
    monthIndex,
    input,
    contractKeys,
  );

  for (const [key, labour] of payrollLabour.labourByKey) {
    getContractBucket(totalsByKey, key).labour = labour;
  }

  const {
    unallocatedLabour,
    estimatedPayrollTotal,
    payrollNotPostedLabels,
    payrollEmployeesWithoutProjectCount,
    payrollEmployeesWithoutProjectLabour,
    payrollScaleWarnings,
    postedPayrollTotal,
  } = payrollLabour;

  const labourIsEstimatedPeriod = payrollNotPostedLabels.length > 0;
  const payrollNotPostedMessage =
    payrollNotPostedLabels.length === 0
      ? null
      : payrollNotPostedLabels.length === 1
        ? `Payroll for ${payrollNotPostedLabels[0]} is not locked yet. Labour is estimated from the open payroll run and is not yet in the company P&L.`
        : `Payroll for ${payrollNotPostedLabels.join(", ")} is not locked yet. Labour is estimated from the open payroll runs and is not yet in the company P&L.`;

  const payrollForPeriod = payrollRowsForCalendarMonth(
    payrollRows,
    financialYear,
    monthIndex,
  );

  const depreciation = depreciationForPeriod(fixedAssets, financialYear, monthIndex);
  const totalOverheadPool = roundCurrency(
    overheadCosts + unallocatedLabour + depreciation,
  );

  let effectiveAllocation: OverheadAllocationMode = allocationMode;
  let allocationFallbackNote: string | null = null;

  const contractRowsDraft: ContractProfitabilityTableRow[] = contractDefs.map(
    (def) => {
      const bucket = totalsByKey.get(def.key) ?? {
        revenue: 0,
        labour: 0,
        direct: 0,
      };
      const revenue = roundCurrency(bucket.revenue);
      const labour = roundCurrency(bucket.labour);
      const directCosts = roundCurrency(bucket.direct);
      const grossMargin = roundCurrency(revenue - labour - directCosts);
      const showEstimate = labourIsEstimatedPeriod && labour > 0;
      return {
        rowKey: def.key,
        kind: "contract" as const,
        label: def.label,
        siteLabels: def.siteLabels,
        revenue,
        labour,
        directCosts,
        grossMargin,
        grossMarginPct: marginPct(grossMargin, revenue),
        overheadShare: 0,
        netMargin: grossMargin,
        netMarginPct: marginPct(grossMargin, revenue),
        labourIsEstimated: showEstimate,
        marginsAreEstimated: showEstimate,
      };
    },
  );

  contractRowsDraft.sort((left, right) => right.revenue - left.revenue);

  if (allocationMode !== "none" && totalOverheadPool > 0) {
    let weights: number[] = [];
    if (allocationMode === "revenue") {
      weights = contractRowsDraft.map((row) => Math.max(0, row.revenue));
    } else {
      const headcountByKey = new Map<string, Set<string>>();
      for (const row of payrollForPeriod) {
        const contractKey = resolveProjectCodeToContractKey(
          row.project_contract,
          projects,
          tenantHasServiceContracts,
        );
        if (!contractKey || !contractKeys.has(contractKey)) {
          continue;
        }
        const set = headcountByKey.get(contractKey) ?? new Set<string>();
        set.add(row.employee_id);
        headcountByKey.set(contractKey, set);
      }
      weights = contractRowsDraft.map(
        (row) => headcountByKey.get(row.rowKey)?.size ?? 0,
      );
    }

    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    if (weightSum <= 0) {
      effectiveAllocation = "none";
      allocationFallbackNote =
        "Overhead allocation fell back to None because every contract had zero revenue (or headcount) for this period.";
    } else {
      let allocated = 0;
      for (let index = 0; index < contractRowsDraft.length; index += 1) {
        const row = contractRowsDraft[index]!;
        const share =
          index === contractRowsDraft.length - 1
            ? roundCurrency(totalOverheadPool - allocated)
            : roundCurrency((totalOverheadPool * weights[index]!) / weightSum);
        allocated += share;
        row.overheadShare = share;
        row.netMargin = roundCurrency(row.grossMargin - share);
        row.netMarginPct = marginPct(row.netMargin, row.revenue);
      }
    }
  }

  const overheadRow: ContractProfitabilityTableRow = {
    rowKey: "overhead",
    kind: "overhead",
    label: "Overhead",
    siteLabels: [],
    revenue: 0,
    labour: roundCurrency(unallocatedLabour),
    directCosts: roundCurrency(overheadCosts + depreciation),
    grossMargin: roundCurrency(-totalOverheadPool),
    grossMarginPct: null,
    overheadShare: 0,
    netMargin: roundCurrency(-totalOverheadPool),
    netMarginPct: null,
  };

  const unallocatedRow: ContractProfitabilityTableRow = {
    rowKey: "unallocated_revenue",
    kind: "unallocated_revenue",
    label: "Unallocated revenue",
    siteLabels: [],
    revenue: roundCurrency(unallocatedRevenue),
    labour: 0,
    directCosts: 0,
    grossMargin: roundCurrency(unallocatedRevenue),
    grossMarginPct: null,
    overheadShare: 0,
    netMargin: roundCurrency(unallocatedRevenue),
    netMarginPct: null,
  };

  const tableRows = [
    ...contractRowsDraft,
    unallocatedRow,
    ...(effectiveAllocation === "none" ? [overheadRow] : []),
  ];

  const companyPl = extractCompanyPlTotals(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    financialYear,
    monthIndex,
  );

  const tableRevenueFixed = roundCurrency(
    contractRowsDraft.reduce((sum, row) => sum + row.revenue, 0) +
      unallocatedRevenue,
  );

  const tableTotalCosts = roundCurrency(
    postedPayrollTotal +
      overheadCosts +
      depreciation +
      contractRowsDraft.reduce((sum, row) => sum + row.directCosts, 0),
  );

  const tableNetProfit = roundCurrency(tableRevenueFixed - tableTotalCosts);
  const tableNetIncludingEstimated = roundCurrency(
    tableNetProfit - estimatedPayrollTotal,
  );

  const revenueDifference = roundCurrency(
    tableRevenueFixed - companyPl.revenue,
  );
  const netProfitDifference = roundCurrency(
    tableNetProfit - companyPl.netProfit,
  );

  const companyTotalRow: ContractProfitabilityTableRow = {
    rowKey: "company_total",
    kind: "company_total",
    label: "Company total",
    siteLabels: [],
    revenue: companyPl.revenue,
    labour: postedPayrollTotal,
    directCosts: roundCurrency(
      companyPl.totalExpenses - postedPayrollTotal - depreciation,
    ),
    grossMargin: roundCurrency(
      companyPl.revenue -
        postedPayrollTotal -
        (companyPl.totalExpenses - postedPayrollTotal - depreciation),
    ),
    grossMarginPct: marginPct(
      companyPl.revenue -
        postedPayrollTotal -
        (companyPl.totalExpenses - postedPayrollTotal - depreciation),
      companyPl.revenue,
    ),
    overheadShare: 0,
    netMargin: companyPl.netProfit,
    netMarginPct: marginPct(companyPl.netProfit, companyPl.revenue),
    netMarginIncludingEstimatedPayroll: tableNetIncludingEstimated,
    netMarginIncludingEstimatedPayrollPct: marginPct(
      tableNetIncludingEstimated,
      companyPl.revenue,
    ),
  };

  const rows = [...tableRows, companyTotalRow];

  const isEmpty =
    companyPl.revenue === 0 &&
    companyPl.totalExpenses === 0 &&
    contractRowsDraft.every(
      (row) => row.revenue === 0 && row.labour === 0 && row.directCosts === 0,
    );

  return {
    rows,
    warnings: {
      voidedIncomeCount,
      voidedIncomeTotal: roundCurrency(voidedIncomeTotal),
      expensesWithoutProjectCount,
      expensesWithoutProjectTotal: roundCurrency(expensesWithoutProjectTotal),
      payrollEmployeesWithoutProjectCount,
      payrollEmployeesWithoutProjectLabour: roundCurrency(
        payrollEmployeesWithoutProjectLabour,
      ),
      allocationFallbackNote,
      payrollDetailExceedsPostedNote:
        payrollScaleWarnings.length > 0 ? payrollScaleWarnings.join(" ") : null,
    },
    reconciliation: {
      companyRevenue: companyPl.revenue,
      companyTotalExpenses: companyPl.totalExpenses,
      companyNetProfit: companyPl.netProfit,
      tableRevenue: tableRevenueFixed,
      tableTotalCosts,
      tableNetProfit,
      estimatedPayrollNotInPl: estimatedPayrollTotal,
      revenueDifference,
      netProfitDifference,
      matchesCompanyPl:
        Math.abs(revenueDifference) <= ROUND_TOLERANCE &&
        Math.abs(netProfitDifference) <= ROUND_TOLERANCE,
    },
    payrollNotPostedMessage,
    isEmpty,
  };
}

export function buildLastSixMonthsNetMarginMatrix(
  input: Omit<
    ContractProfitabilityBuildInput,
    "monthIndex" | "allocationMode" | "financialYear"
  > & {
    endYear: number;
    endMonthIndex: number;
    allocationMode: OverheadAllocationMode;
  },
): {
  monthLabels: string[];
  estimatedMonthFlags: boolean[];
  contractKeys: string[];
  contractLabels: Map<string, string>;
  values: Map<string, number[]>;
} {
  const monthLabels: string[] = [];
  const estimatedMonthFlags: boolean[] = [];
  const contractDefs = buildContractKeyDefs({
    ...input,
    financialYear: input.endYear,
    monthIndex: 0,
    allocationMode: input.allocationMode,
  });
  const contractKeys = contractDefs.map((def) => def.key);
  const contractLabels = new Map(
    contractDefs.map((def) => [def.key, def.label]),
  );
  const values = new Map<string, number[]>();

  for (const key of contractKeys) {
    values.set(key, []);
  }

  let year = input.endYear;
  let monthIndex = input.endMonthIndex;

  for (let step = 0; step < 6; step += 1) {
    monthLabels.unshift(
      `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    );
    const report = buildContractProfitabilityReport({
      ...input,
      financialYear: year,
      monthIndex,
      allocationMode: input.allocationMode,
    });
    estimatedMonthFlags.unshift(
      (report.reconciliation.estimatedPayrollNotInPl ?? 0) > ROUND_TOLERANCE,
    );
    for (const key of contractKeys) {
      const row = report.rows.find(
        (entry) => entry.rowKey === key && entry.kind === "contract",
      );
      values.get(key)!.unshift(row?.netMargin ?? 0);
    }

    monthIndex -= 1;
    if (monthIndex < 0) {
      monthIndex = 11;
      year -= 1;
    }
  }

  return {
    monthLabels,
    estimatedMonthFlags,
    contractKeys,
    contractLabels,
    values,
  };
}
