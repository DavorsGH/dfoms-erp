/**
 * In-memory: reproduce David's sequence (migrate → reverse lent → company_paid x2;
 * reverse migrated repaid). BS must balance at every step with patched manuals.
 *
 *   npx tsx scripts/test-directors-loan-migration-sequence-staging.ts
 */
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import {
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/profit-loss-utils";
import {
  patchManualFinancialEntriesForDirectorLoanLedger,
  type DirectorsLoanLedgerEntry,
} from "../app/dashboard/finance/directors-loan-ledger-utils";
import type { ManualFinancialEntryRecord } from "../app/dashboard/finance/manual-financial-entries-utils";

const TENANT = "00000001-0000-4000-8000-000000000001";
const LOGISTICS_BU = "2ae591d2-0f89-44d0-83af-1133cfe7a32c";
const FACILITIES_BU = "608f81b5-38be-4756-8a52-8279c859b07c";
const FY = 2026;
const TOL = 0.05;

const emptyInventory = {
  config: { valuationMethod: "wac" as const },
  cashPurchases: [],
  productCashPurchases: [],
  rawMaterialStock: createEmptyMonthlyTotals(),
  productStock: createEmptyMonthlyTotals(),
  rawMaterialWac: createEmptyMonthlyTotals(),
  productWac: createEmptyMonthlyTotals(),
};

function assertBalanced(bs: ReturnType<typeof buildBalanceSheetReport>, label: string) {
  for (let mi = 0; mi < 12; mi += 1) {
    const check = getBalanceCheckForPeriod(bs, mi);
    if (Math.abs(check.difference) > TOL) {
      throw new Error(`${label} M${mi + 1}: imbalance ${check.difference}`);
    }
  }
}

function buildBs(
  manual: ManualFinancialEntryRecord[],
  ledger: DirectorsLoanLedgerEntry[],
  buId: string,
) {
  const manualYear = manual.filter((m) => String(m.period_month).startsWith(String(FY)));
  const scopedLedger = ledger.filter((e) => e.business_unit_id === buId);
  const opts = {
    tenantId: TENANT,
    accountsPayablePayments: [],
    directorsLoanRepayments: [],
    directorsLoanLedgerEntries: scopedLedger,
  };
  return buildBalanceSheetReport(
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    FY,
    emptyInventory,
    manualYear,
    [],
    [],
    opts,
  );
}

function simLedger(
  partial: Omit<DirectorsLoanLedgerEntry, "tenant_id" | "created_at" | "created_by"> &
    Partial<Pick<DirectorsLoanLedgerEntry, "id">>,
): DirectorsLoanLedgerEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    tenant_id: TENANT,
    created_at: new Date().toISOString(),
    created_by: null,
    notes: null,
    linked_expense_id: null,
    reversed_by: null,
    reversal_reason: null,
    reference: partial.reference ?? null,
    description: partial.description ?? "test",
    ...partial,
  };
}

async function main() {
  const manuals: ManualFinancialEntryRecord[] = [
    {
      id: "m-fac-aug",
      tenant_id: TENANT,
      period_month: "2026-08-01",
      business_unit_id: FACILITIES_BU,
      bank_loans: 0,
      loan_proceeds: 3200,
      loan_repayments: 0,
      directors_loan: 0,
    } as ManualFinancialEntryRecord,
    {
      id: "m-log-sep",
      tenant_id: TENANT,
      period_month: "2026-09-01",
      business_unit_id: LOGISTICS_BU,
      bank_loans: 220000,
      loan_proceeds: 228000,
      loan_repayments: 0,
      directors_loan: 0,
    } as ManualFinancialEntryRecord,
  ];

  let ledger: DirectorsLoanLedgerEntry[] = [
    simLedger({
      business_unit_id: FACILITIES_BU,
      entry_date: "2026-08-31",
      entry_type: "director_lent_company",
      amount: 3200,
      reference: "migrated",
      reversed_at: null,
    }),
    simLedger({
      business_unit_id: FACILITIES_BU,
      entry_date: "2026-08-29",
      entry_type: "company_repaid_director",
      amount: 3200,
      reference: "migrated-repayment",
      reversed_at: null,
    }),
    simLedger({
      id: "migrated-lent-log",
      business_unit_id: LOGISTICS_BU,
      entry_date: "2026-09-30",
      entry_type: "director_lent_company",
      amount: 8000,
      reference: "migrated",
      reversed_at: null,
    }),
  ];

  let patched = patchManualFinancialEntriesForDirectorLoanLedger(manuals, ledger, FY);

  console.log("Step 0: post-migration (patched manuals + ledger)");
  assertBalanced(buildBs(patched, ledger, LOGISTICS_BU), "logistics migrate");
  assertBalanced(buildBs(patched, ledger, FACILITIES_BU), "facilities migrate");

  ledger = ledger.map((e) =>
    e.id === "migrated-lent-log"
      ? { ...e, reversed_at: "2026-09-27T21:23:19.81+00:00", reversal_reason: "test" }
      : e,
  );

  console.log("Step 1: reverse migrated Logistics lent");
  assertBalanced(buildBs(patched, ledger, LOGISTICS_BU), "after reverse lent");

  ledger = [
    ...ledger,
    simLedger({
      business_unit_id: LOGISTICS_BU,
      entry_date: "2026-09-18",
      entry_type: "company_paid_for_director",
      amount: 6000,
      reversed_at: null,
    }),
    simLedger({
      business_unit_id: LOGISTICS_BU,
      entry_date: "2026-09-21",
      entry_type: "company_paid_for_director",
      amount: 2000,
      reversed_at: null,
    }),
  ];

  console.log("Step 2: David sequence — company_paid_for_director 6k + 2k");
  assertBalanced(buildBs(patched, ledger, LOGISTICS_BU), "after company_paid x2");

  const repaidId = ledger.find(
    (e) => e.entry_type === "company_repaid_director" && !e.reversed_at,
  )!.id;
  ledger = ledger.map((e) =>
    e.id === repaidId
      ? { ...e, reversed_at: new Date().toISOString(), reversal_reason: "test" }
      : e,
  );

  console.log("Step 3: reverse migrated Facilities repaid");
  assertBalanced(buildBs(patched, ledger, FACILITIES_BU), "after reverse repaid");

  console.log("\nPASS — migration sequence BS balanced at every step.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
