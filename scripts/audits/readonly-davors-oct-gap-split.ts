import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildCustomerCreditsBalanceSheetOptions,
  fetchBalanceSheetPageData,
} from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../../app/dashboard/finance/balance-sheet-utils";

const TENANT = "00000001-0000-4000-8000-000000000001";
const BU = "de215200-e92b-48e3-a7ba-977d7289868c";
const FY = 2026;
const OCT = 9;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function buildReport(
  data: Awaited<ReturnType<typeof fetchBalanceSheetPageData>>,
  fullOpts: boolean,
) {
  const opts = fullOpts
    ? {
        tenantId: TENANT,
        accountsPayablePayments: data.initialAccountsPayablePayments,
        directorsLoanRepayments: data.initialDirectorsLoanRepayments,
        directorsLoanLedgerEntries: data.initialDirectorsLoanLedgerEntries,
        ...buildCustomerCreditsBalanceSheetOptions(data),
      }
    : { tenantId: TENANT };
  return buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    data.initialWelfareFundEntries,
    opts,
  );
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    activeBusinessUnitId: BU,
    viewAllBusinessUnits: false,
  });
  const full = buildReport(data, true);
  const min = buildReport(data, false);
  const cf = getBalanceCheckForPeriod(full, OCT);
  const cm = getBalanceCheckForPeriod(min, OCT);
  console.log("Oct full diff", cf.difference, "minimal", cm.difference, "delta", cm.difference - cf.difference);
  console.log("\nRow deltas (minimal - full):");
  const deltas: Array<{ key: string; d: number }> = [];
  for (const row of full.rows) {
    if (row.kind === "section") continue;
    const d =
      getBalanceSheetAmountForMonth(row, OCT) -
      getBalanceSheetAmountForMonth(
        min.rows.find((r) => r.key === row.key) ?? row,
        OCT,
      );
    if (Math.abs(d) >= 0.01) deltas.push({ key: row.key, d: Math.round(d * 100) / 100 });
  }
  deltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  for (const x of deltas) console.log(x.key, x.d);
}

main();
