import {
  calculateShareCapitalByMonth,
  getMonthEndDate,
  type CapitalContributionEntry,
} from "./capital-contributions-utils";
import {
  buildNetPayByPayrollMonth,
  calculateAccruedWagesPayableByMonth,
  type BalanceSheetCashExpenseEntry,
  type MonthEndCloseNetPayEntry,
  type PayrollHistoryWagesEntry,
} from "./accrued-wages-utils";
import { calculateMonthlyNetBookValueTotals } from "./fixed-assets-utils";
import {
  buildProfitLossReport,
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  sumMonthlyTotals,
  type MonthlyTotals,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "./profit-loss-utils";
import { getCurrentFinancialYear } from "./finance-year-utils";
import {
  getIncomeEntryOutstanding,
  isActiveIncomeForReporting,
} from "./income-register-utils";
import {
  buildClosingCashByMonth,
  buildMonthlyCashComponents,
  resolveJanuaryOpeningCashBalance,
  type CashMovementManualEntry,
} from "./cash-movement-utils";
import {
  calculateInventoryByMonth,
  calculateInventoryOpeningEquityByMonth,
  type FinishedProductAverageCostRow,
  type InventoryBalanceConfig,
  type ProductPurchaseCashEntry,
  type RawMaterialPurchaseCashEntry,
} from "../inventory/inventory-balance-sheet-utils";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import type { RawMaterialRecord } from "../inventory/raw-materials-utils";
import {
  PAYROLL_PAYABLE_CATEGORY_PAYE,
  PAYROLL_PAYABLE_CATEGORY_SSNIT,
} from "../hr-payroll/payroll-lock-finance-utils";
import type {
  TaxLedgerComponent,
  TaxLedgerDirection,
  TaxLedgerStatus,
} from "./tax-ledger-utils";

export { MONTH_LABELS, FULL_YEAR_INDEX } from "./profit-loss-utils";
export { calculateFixedAssetPurchaseOutflowsByMonth } from "./fixed-assets-utils";

export const BALANCE_TOLERANCE = 0.01;

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => roundCurrency(value));
}

export type BalanceSheetAccountsPayableEntry = {
  invoice_date: string;
  balance_due: number | null;
  amount: number;
  amount_paid: number;
  /** Used to soft-exclude historical statutory remittance AP (Option A). */
  vendor_name?: string | null;
  invoice_number?: string | null;
  expense_category?: string | null;
};

export type BalanceSheetIncomeEntry = {
  date: string;
  amount: number;
  amount_received: number;
  outstanding_balance: number | null;
  wht_amount?: number | null;
  service_category: string;
  entry_type?: "service" | "product_sale" | null;
  sale_status?: "active" | "voided" | null;
};

/**
 * Open tax_ledger_entries rows for BS assets/liabilities.
 * AR already excludes WHT (Amount − Received − WHT); WHT Receivable restores
 * that asset. Output VAT stays inside AR (gross receivable) while Net VAT
 * Payable is the matching liability — standard VAT invoice accounting.
 */
export type BalanceSheetTaxLedgerEntry = {
  entry_date: string;
  direction: TaxLedgerDirection;
  tax_component: TaxLedgerComponent;
  tax_amount: number;
  status: TaxLedgerStatus;
};

export type BalanceSheetRow = {
  key: string;
  label: string;
  amounts: MonthlyTotals;
  kind: "section" | "data" | "subtotal" | "total";
  side?: "assets" | "liabilities" | "equity" | "combined";
};

export type InventoryBalanceSheetInput = {
  config: InventoryBalanceConfig | null;
  rawMaterials: Array<
    Pick<
      RawMaterialRecord,
      "current_stock" | "average_cost_per_unit" | "reorder_level"
    >
  >;
  finishedProducts: Array<Pick<FinishedProductRecord, "id" | "current_stock">>;
  finishedProductAverageCosts: FinishedProductAverageCostRow[];
  cashPurchases: RawMaterialPurchaseCashEntry[];
  productCashPurchases: ProductPurchaseCashEntry[];
  referenceDate?: Date;
};

export type BalanceSheetReport = {
  financialYear: number;
  rows: BalanceSheetRow[];
  totalAssets: MonthlyTotals;
  totalLiabilities: MonthlyTotals;
  totalEquity: MonthlyTotals;
  totalLiabilitiesAndEquity: MonthlyTotals;
};

export type BalanceSheetMonthRow = {
  key: string;
  label: string;
  amount: number;
  kind: BalanceSheetRow["kind"];
};

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

/**
 * Option A soft-deprecation: tax_ledger_entries is SoR for SSNIT/PAYE remittance.
 * Exclude historical unpaid Statutory SSNIT/GRA AP so BS does not double-count
 * the same liability as both AP and open statutory_payable ledger rows.
 *
 * Match rule (any one):
 * - vendor_name is SSNIT or GRA (case-insensitive)
 * - expense_category is Statutory - SSNIT / Statutory - PAYE
 * - invoice_number starts with PAYROLL-SSNIT / PAYROLL-PAYE / PAYROLL-GRA
 */
export function isStatutoryRemittancePayable(entry: {
  vendor_name?: string | null;
  invoice_number?: string | null;
  expense_category?: string | null;
}): boolean {
  const vendor = entry.vendor_name?.trim().toUpperCase() ?? "";
  if (vendor === "SSNIT" || vendor === "GRA") {
    return true;
  }

  const category = entry.expense_category?.trim() ?? "";
  if (
    category === PAYROLL_PAYABLE_CATEGORY_SSNIT ||
    category === PAYROLL_PAYABLE_CATEGORY_PAYE
  ) {
    return true;
  }

  const invoice = entry.invoice_number?.trim().toUpperCase() ?? "";
  return (
    invoice.startsWith("PAYROLL-SSNIT") ||
    invoice.startsWith("PAYROLL-PAYE") ||
    invoice.startsWith("PAYROLL-GRA")
  );
}

function getOutstandingBalance(entry: BalanceSheetIncomeEntry): number {
  if (entry.outstanding_balance !== null && entry.outstanding_balance !== undefined) {
    return Number(entry.outstanding_balance) || 0;
  }

  return getIncomeEntryOutstanding(entry);
}

function getPayableBalance(entry: BalanceSheetAccountsPayableEntry): number {
  if (entry.balance_due !== null && entry.balance_due !== undefined) {
    return Math.max(Number(entry.balance_due) || 0, 0);
  }

  return Math.max((Number(entry.amount) || 0) - (Number(entry.amount_paid) || 0), 0);
}

function calculateAccountsReceivableByMonth(
  incomeEntries: BalanceSheetIncomeEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);

    totals[month - 1] = incomeEntries.reduce((sum, entry) => {
      if (!isActiveIncomeForReporting(entry)) {
        return sum;
      }

      const entryDate = normalizeDate(entry.date);
      if (!entryDate || entryDate > monthEnd) {
        return sum;
      }

      return sum + getOutstandingBalance(entry);
    }, 0);
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

function calculateAccountsPayableByMonth(
  payableEntries: BalanceSheetAccountsPayableEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);

    totals[month - 1] = payableEntries.reduce((sum, entry) => {
      if (isStatutoryRemittancePayable(entry)) {
        return sum;
      }

      const entryDate = normalizeDate(entry.invoice_date);
      if (!entryDate || entryDate > monthEnd) {
        return sum;
      }

      return sum + getPayableBalance(entry);
    }, 0);
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

type OpenTaxBalancesByMonth = {
  whtReceivable: MonthlyTotals;
  whtPayable: MonthlyTotals;
  netVatPayable: MonthlyTotals;
  netVatReceivable: MonthlyTotals;
  payePayable: MonthlyTotals;
  ssnitPayable: MonthlyTotals;
};

/**
 * Point-in-time open tax_ledger balances (status='open', entry_date ≤ month-end).
 * Net VAT = output (vat_bundle + vfrs) − input; positive → liability, negative → asset.
 * SSNIT Payable groups employee + employer_tier1 + tier2 (one remittance line).
 */
function calculateOpenTaxBalancesByMonth(
  taxLedgerEntries: BalanceSheetTaxLedgerEntry[],
  financialYear: number,
): OpenTaxBalancesByMonth {
  const whtReceivable = createEmptyMonthlyTotals();
  const whtPayable = createEmptyMonthlyTotals();
  const netVatPayable = createEmptyMonthlyTotals();
  const netVatReceivable = createEmptyMonthlyTotals();
  const payePayable = createEmptyMonthlyTotals();
  const ssnitPayable = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);
    let outputVat = 0;
    let inputVat = 0;
    let whtRecv = 0;
    let whtPay = 0;
    let paye = 0;
    let ssnit = 0;

    for (const entry of taxLedgerEntries) {
      if (entry.status !== "open") {
        continue;
      }

      const entryDate = normalizeDate(entry.entry_date);
      if (!entryDate || entryDate > monthEnd) {
        continue;
      }

      const amount = Number(entry.tax_amount) || 0;

      switch (entry.direction) {
        case "wht_receivable":
          whtRecv += amount;
          break;
        case "wht_payable":
          whtPay += amount;
          break;
        case "output":
          outputVat += amount;
          break;
        case "input":
          inputVat += amount;
          break;
        case "statutory_payable":
          if (entry.tax_component === "paye") {
            paye += amount;
          } else if (
            entry.tax_component === "ssnit_employee" ||
            entry.tax_component === "ssnit_employer_tier1" ||
            entry.tax_component === "ssnit_tier2"
          ) {
            ssnit += amount;
          }
          break;
        default:
          break;
      }
    }

    const netVat = roundCurrency(outputVat - inputVat);
    whtReceivable[month - 1] = roundCurrency(whtRecv);
    whtPayable[month - 1] = roundCurrency(whtPay);
    netVatPayable[month - 1] = netVat > 0 ? netVat : 0;
    netVatReceivable[month - 1] = netVat < 0 ? roundCurrency(-netVat) : 0;
    payePayable[month - 1] = roundCurrency(paye);
    ssnitPayable[month - 1] = roundCurrency(ssnit);
  }

  whtReceivable[FULL_YEAR_INDEX] = whtReceivable[11];
  whtPayable[FULL_YEAR_INDEX] = whtPayable[11];
  netVatPayable[FULL_YEAR_INDEX] = netVatPayable[11];
  netVatReceivable[FULL_YEAR_INDEX] = netVatReceivable[11];
  payePayable[FULL_YEAR_INDEX] = payePayable[11];
  ssnitPayable[FULL_YEAR_INDEX] = ssnitPayable[11];

  return {
    whtReceivable,
    whtPayable,
    netVatPayable,
    netVatReceivable,
    payePayable,
    ssnitPayable,
  };
}

function calculateFixedAssetsNetByMonth(
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
): MonthlyTotals {
  return calculateMonthlyNetBookValueTotals(fixedAssets, financialYear);
}

function calculateRetainedEarningsByMonth(
  incomeEntries: ProfitLossIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  const report = buildProfitLossReport(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    financialYear,
  );
  const netProfitRow = report.rows.find((row) => row.key === "net-profit");

  if (!netProfitRow) {
    return totals;
  }

  let cumulative = 0;

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    cumulative += netProfitRow.amounts[monthIndex] ?? 0;
    totals[monthIndex] = cumulative;
  }

  totals[FULL_YEAR_INDEX] = cumulative;
  return totals;
}

function calculateCashAndCashEquivalentsByMonth(
  capitalContributions: CapitalContributionEntry[],
  incomeEntries: BalanceSheetIncomeEntry[],
  expenseEntries: BalanceSheetCashExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  rawMaterialCashPurchases: RawMaterialPurchaseCashEntry[],
  productCashPurchases: ProductPurchaseCashEntry[],
  inventoryConfig: InventoryBalanceConfig | null,
  manualEntries: CashMovementManualEntry[],
  financialYear: number,
  staffSalaryNetByPayrollMonth?: Map<string, number>,
): MonthlyTotals {
  const components = buildMonthlyCashComponents(
    {
      incomeEntries,
      expenseEntries,
      capitalContributions,
      fixedAssets,
      rawMaterialCashPurchases,
      productCashPurchases,
      inventoryConfig,
      manualEntries,
      staffSalaryNetByPayrollMonth,
    },
    financialYear,
  );
  const januaryOpening = resolveJanuaryOpeningCashBalance(
    manualEntries,
    financialYear,
  );
  return buildClosingCashByMonth(components.netMovement, januaryOpening);
}

export function getBalanceSheetAmountForMonth(
  row: BalanceSheetRow,
  monthIndex: number,
): number {
  if (row.kind === "section") {
    return 0;
  }

  return roundCurrency(row.amounts[monthIndex] ?? 0);
}

export function getBalanceSheetForMonth(
  report: BalanceSheetReport,
  monthIndex: number,
): BalanceSheetMonthRow[] {
  return report.rows.map((row) => ({
    key: row.key,
    label: row.label,
    kind: row.kind,
    amount: getBalanceSheetAmountForMonth(row, monthIndex),
  }));
}

export function getBalanceCheckForPeriod(
  report: BalanceSheetReport,
  periodIndex = FULL_YEAR_INDEX,
) {
  const totalAssets = roundCurrency(report.totalAssets[periodIndex] ?? 0);
  const totalLiabilitiesAndEquity = roundCurrency(
    report.totalLiabilitiesAndEquity[periodIndex] ?? 0,
  );
  const difference = roundCurrency(totalAssets - totalLiabilitiesAndEquity);
  const isBalanced = Math.abs(difference) <= BALANCE_TOLERANCE;

  return {
    totalAssets,
    totalLiabilitiesAndEquity,
    difference,
    isBalanced,
  };
}

export function buildBalanceSheetReport(
  incomeEntries: BalanceSheetIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  payableEntries: BalanceSheetAccountsPayableEntry[],
  capitalContributions: CapitalContributionEntry[],
  cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[],
  payrollHistory: PayrollHistoryWagesEntry[],
  monthEndCloseNetPay: MonthEndCloseNetPayEntry[] = [],
  financialYear = getCurrentFinancialYear(),
  inventoryInput: InventoryBalanceSheetInput = {
    config: null,
    rawMaterials: [],
    finishedProducts: [],
    finishedProductAverageCosts: [],
    cashPurchases: [],
    productCashPurchases: [],
  },
  manualEntries: CashMovementManualEntry[] = [],
  taxLedgerEntries: BalanceSheetTaxLedgerEntry[] = [],
): BalanceSheetReport {
  const staffSalaryNetByPayrollMonth = buildNetPayByPayrollMonth(
    payrollHistory,
    monthEndCloseNetPay,
  );
  const cash = calculateCashAndCashEquivalentsByMonth(
    capitalContributions,
    incomeEntries,
    cashFlowExpenseEntries,
    fixedAssets,
    inventoryInput.cashPurchases,
    inventoryInput.productCashPurchases,
    inventoryInput.config,
    manualEntries,
    financialYear,
    staffSalaryNetByPayrollMonth,
  );
  const accountsReceivable = roundMonthlyTotals(
    calculateAccountsReceivableByMonth(incomeEntries, financialYear),
  );
  const openTax = calculateOpenTaxBalancesByMonth(
    taxLedgerEntries,
    financialYear,
  );
  const fixedAssetsNet = roundMonthlyTotals(
    calculateFixedAssetsNetByMonth(fixedAssets, financialYear),
  );
  const inventory = roundMonthlyTotals(
    calculateInventoryByMonth(
      inventoryInput.rawMaterials,
      inventoryInput.finishedProducts,
      inventoryInput.finishedProductAverageCosts,
      inventoryInput.config,
      financialYear,
      inventoryInput.referenceDate,
    ),
  );
  const totalAssets = roundMonthlyTotals(
    sumMonthlyTotals([
      cash,
      accountsReceivable,
      openTax.whtReceivable,
      openTax.netVatReceivable,
      fixedAssetsNet,
      inventory,
    ]),
  );

  const accountsPayable = roundMonthlyTotals(
    calculateAccountsPayableByMonth(payableEntries, financialYear),
  );
  const accruedWagesPayable = roundMonthlyTotals(
    calculateAccruedWagesPayableByMonth(
      payrollHistory,
      cashFlowExpenseEntries,
      financialYear,
      monthEndCloseNetPay,
    ),
  );
  const totalLiabilities = roundMonthlyTotals(
    sumMonthlyTotals([
      accountsPayable,
      accruedWagesPayable,
      openTax.whtPayable,
      openTax.netVatPayable,
      openTax.payePayable,
      openTax.ssnitPayable,
    ]),
  );

  const shareCapital = roundMonthlyTotals(
    calculateShareCapitalByMonth(capitalContributions, financialYear),
  );
  const retainedEarnings = roundMonthlyTotals(
    calculateRetainedEarningsByMonth(
      incomeEntries,
      expenseEntries,
      fixedAssets,
      financialYear,
    ),
  );
  const inventoryOpeningEquity = roundMonthlyTotals(
    calculateInventoryOpeningEquityByMonth(inventoryInput.config, financialYear),
  );
  const totalEquity = roundMonthlyTotals(
    sumMonthlyTotals([shareCapital, retainedEarnings, inventoryOpeningEquity]),
  );
  const totalLiabilitiesAndEquity = roundMonthlyTotals(
    sumMonthlyTotals([
      accountsPayable,
      accruedWagesPayable,
      openTax.whtPayable,
      openTax.netVatPayable,
      openTax.payePayable,
      openTax.ssnitPayable,
      shareCapital,
      retainedEarnings,
      inventoryOpeningEquity,
    ]),
  );

  const rows: BalanceSheetRow[] = [
    {
      key: "assets-section",
      label: "ASSETS",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "assets",
    },
    {
      key: "cash",
      label: "Cash and Cash Equivalents",
      amounts: cash,
      kind: "data",
      side: "assets",
    },
    {
      key: "accounts-receivable",
      label: "Accounts Receivable",
      amounts: accountsReceivable,
      kind: "data",
      side: "assets",
    },
    {
      key: "wht-receivable",
      label: "WHT Receivable",
      amounts: openTax.whtReceivable,
      kind: "data",
      side: "assets",
    },
    {
      key: "net-vat-receivable",
      label: "Net VAT Receivable",
      amounts: openTax.netVatReceivable,
      kind: "data",
      side: "assets",
    },
    {
      key: "fixed-assets-net",
      label: "Fixed Assets (Net)",
      amounts: fixedAssetsNet,
      kind: "data",
      side: "assets",
    },
    {
      key: "inventory",
      label: "Inventory",
      amounts: inventory,
      kind: "data",
      side: "assets",
    },
    {
      key: "total-assets",
      label: "TOTAL ASSETS",
      amounts: totalAssets,
      kind: "subtotal",
      side: "assets",
    },
    {
      key: "liabilities-section",
      label: "LIABILITIES",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "liabilities",
    },
    {
      key: "accounts-payable",
      label: "Accounts Payable",
      amounts: accountsPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "accrued-wages-payable",
      label: "Accrued Wages Payable",
      amounts: accruedWagesPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "wht-payable",
      label: "WHT Payable",
      amounts: openTax.whtPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "net-vat-payable",
      label: "Net VAT Payable",
      amounts: openTax.netVatPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "paye-payable",
      label: "PAYE Payable",
      amounts: openTax.payePayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "ssnit-payable",
      label: "SSNIT Payable",
      amounts: openTax.ssnitPayable,
      kind: "data",
      side: "liabilities",
    },
    {
      key: "total-liabilities",
      label: "TOTAL LIABILITIES",
      amounts: totalLiabilities,
      kind: "subtotal",
      side: "liabilities",
    },
    {
      key: "equity-section",
      label: "EQUITY",
      amounts: createEmptyMonthlyTotals(),
      kind: "section",
      side: "equity",
    },
    {
      key: "share-capital",
      label: "Share Capital",
      amounts: shareCapital,
      kind: "data",
      side: "equity",
    },
    {
      key: "retained-earnings",
      label: "Retained Earnings",
      amounts: retainedEarnings,
      kind: "data",
      side: "equity",
    },
    {
      key: "inventory-opening-equity",
      label: "Inventory Opening Balance",
      amounts: inventoryOpeningEquity,
      kind: "data",
      side: "equity",
    },
    {
      key: "total-equity",
      label: "TOTAL EQUITY",
      amounts: totalEquity,
      kind: "subtotal",
      side: "equity",
    },
    {
      key: "total-liabilities-equity",
      label: "TOTAL LIABILITIES + EQUITY",
      amounts: totalLiabilitiesAndEquity,
      kind: "total",
      side: "combined",
    },
  ];

  return {
    financialYear,
    rows,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity,
  };
}
