import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildMonthlyCashComponents,
  buildClosingCashByMonth,
  resolveJanuaryOpeningCashBalance,
} from "../../app/dashboard/finance/cash-movement-utils";
import { buildStandardBalanceSheetReportOptions } from "../../lib/finance/balance-sheet-standard-report";

const TENANT = "00000001-0000-4000-8000-000000000001";
const TECH = "d251c562-d522-43ec-8d9c-d1d00d4105b0";
const FY = 2026;

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    viewAllBusinessUnits: false,
    activeBusinessUnitId: TECH,
  });
  const opts = buildStandardBalanceSheetReportOptions(TENANT, data);
  console.log("ledger entries:", opts.directorsLoanLedgerEntries);
  const inv = data.initialInventoryBalanceSheet;
  const components = buildMonthlyCashComponents(
    {
      tenantId: TENANT,
      incomeEntries: data.initialIncomeEntries,
      expenseEntries: data.initialCashFlowExpenseEntries,
      capitalContributions: data.initialCapitalContributions,
      fixedAssets: data.initialFixedAssets,
      rawMaterialCashPurchases: inv.cashPurchases,
      productCashPurchases: inv.productCashPurchases,
      inventoryConfig: inv.config,
      manualEntries: data.initialManualEntries,
      accountsPayableSettlements: data.initialPayableEntries,
      accountsPayablePayments: opts.accountsPayablePayments,
      directorsLoanRepayments: opts.directorsLoanRepayments,
      directorsLoanLedgerEntries: opts.directorsLoanLedgerEntries,
    },
    FY,
  );
  const opening = resolveJanuaryOpeningCashBalance(
    data.initialManualEntries,
    FY,
  );
  const closing = buildClosingCashByMonth(components.netMovement, opening);
  console.log("manual rows loaded:", data.initialManualEntries);
  console.log("Aug components:", {
    loanProceeds: components.loanProceeds[7],
    directorsLoanRepayments: components.directorsLoanRepayments[7],
    directorsLoanInflows: components.directorsLoanInflows[7],
    netMovement: components.netMovement[7],
    closingCash: closing[7],
  });
}

main();
