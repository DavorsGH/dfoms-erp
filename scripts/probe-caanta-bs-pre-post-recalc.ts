/**
 * Read-only: compare Caanta Aug 2026 BS before/after VFRS recalc (in-memory simulation).
 *
 * Usage:
 *   npx tsx scripts/probe-caanta-bs-pre-post-recalc.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const AUGUST_INDEX = 7;
const FY = 2026;

const BEFORE_PATCH: Record<
  string,
  { net: number; vat: number; comp: "vfrs" }
> = {
  "728e5c8e-f8a7-4a2b-8f2b-99926935ada2": { net: 0.97, vat: 0.03, comp: "vfrs" },
  "8c095950-5e00-4247-894a-2d72771a42a8": {
    net: 19.42,
    vat: 0.58,
    comp: "vfrs",
  },
  "ddcf15f4-ea46-4306-af2f-caf16b38bd39": {
    net: 58.25,
    vat: 1.75,
    comp: "vfrs",
  },
  "feb8cecc-f5ec-4acd-8f5a-d461e1eaccc2": {
    net: 970.87,
    vat: 29.13,
    comp: "vfrs",
  },
  "abd621b3-2b6b-4f4c-a148-c3fdb9f131a9": {
    net: 97.09,
    vat: 2.91,
    comp: "vfrs",
  },
};

const BEFORE_LEGS = [
  {
    entry_date: "2026-07-26",
    tax_amount: 0.03,
  },
  { entry_date: "2026-08-06", tax_amount: 0.58 },
  { entry_date: "2026-08-06", tax_amount: 1.75 },
  { entry_date: "2026-08-06", tax_amount: 29.13 },
  { entry_date: "2026-08-06", tax_amount: 2.91 },
];

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
  reportOptions: {
    tenantId: string;
    accountsPayablePayments: typeof data.initialAccountsPayablePayments;
    directorsLoanRepayments: typeof data.initialDirectorsLoanRepayments;
  },
  simulateBefore: boolean,
) {
  const income = data.initialIncomeEntries.map((row) => {
    if (!simulateBefore) {
      return row;
    }

    const patch = BEFORE_PATCH[row.id];
    if (!patch) {
      return row;
    }

    return {
      ...row,
      net_of_tax_amount: patch.net,
      output_vat_amount: patch.vat,
      output_tax_component: patch.comp,
    };
  });

  const taxLedger = [...data.initialTaxLedgerEntries];
  if (simulateBefore) {
    for (const leg of BEFORE_LEGS) {
      taxLedger.push({
        entry_date: leg.entry_date,
        direction: "output",
        tax_component: "vfrs",
        tax_amount: leg.tax_amount,
        status: "open",
      });
    }
  }

  return buildBalanceSheetReport(
    income,
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
    taxLedger,
    reportOptions,
  );
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing: expected staging ${STAGING_REF}`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const data = await fetchBalanceSheetPageData(admin, TENANT_ID);
  if (data.fetchError) {
    throw new Error(data.fetchError);
  }

  const reportOptions = {
    tenantId: TENANT_ID,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
  };

  const current = buildReport(data, reportOptions, false);
  const simulatedBefore = buildReport(data, reportOptions, true);
  const currentCheck = getBalanceCheckForPeriod(current, AUGUST_INDEX);
  const beforeCheck = getBalanceCheckForPeriod(simulatedBefore, AUGUST_INDEX);

  console.log("=== Caanta Market — August 2026 BS (staging) ===\n");
  console.log("CURRENT (post-recalc DB state):");
  console.log(
    JSON.stringify(
      {
        totalAssets: currentCheck.totalAssets,
        totalLiabilitiesAndEquity: currentCheck.totalLiabilitiesAndEquity,
        difference: currentCheck.difference,
      },
      null,
      2,
    ),
  );

  console.log("\nSIMULATED PRE-RECALC (in-memory restore of 5 rows + VFRS legs):");
  console.log(
    JSON.stringify(
      {
        totalAssets: beforeCheck.totalAssets,
        totalLiabilitiesAndEquity: beforeCheck.totalLiabilitiesAndEquity,
        difference: beforeCheck.difference,
      },
      null,
      2,
    ),
  );

  console.log(
    `\nImbalance delta (current − simulated before): ${Math.round((currentCheck.difference - beforeCheck.difference) * 100) / 100}`,
  );

  const keys = [
    "accounts-receivable",
    "net-vat-payable",
    "retained-earnings",
    "total-assets",
    "total-liabilities",
    "total-equity",
    "total-liabilities-equity",
  ] as const;

  console.log("\nLine-item deltas at August (current − simulated before):");
  for (const key of keys) {
    const rowCurrent = current.rows.find((row) => row.key === key);
    const rowBefore = simulatedBefore.rows.find((row) => row.key === key);
    if (!rowCurrent || !rowBefore) continue;
    const delta =
      getBalanceSheetAmountForMonth(rowCurrent, AUGUST_INDEX) -
      getBalanceSheetAmountForMonth(rowBefore, AUGUST_INDEX);
    console.log(`  ${key}: ${Math.round(delta * 100) / 100}`);
  }

  const vfrsRemoved = BEFORE_LEGS.reduce(
    (sum, leg) => sum + leg.tax_amount,
    0,
  );
  const netRevenueDelta = Object.values(BEFORE_PATCH).reduce(
    (sum, patch) => sum + patch.vat,
    0,
  );
  console.log("\nAnalytical check:");
  console.log(`  VFRS output tax restored in simulation: GHS ${Math.round(vfrsRemoved * 100) / 100}`);
  console.log(`  Revenue (net_of_tax) reduction in simulation: GHS ${Math.round(netRevenueDelta * 100) / 100}`);
  console.log(
    `  Symmetric? ${Math.abs(vfrsRemoved - netRevenueDelta) < 0.001 ? "yes" : "no"}`,
  );

  const { data: events, error: eventsError } = await admin
    .from("system_event_log")
    .select("created_at, status, message, metadata")
    .eq("event_type", "balance-sheet-integrity")
    .order("created_at", { ascending: false })
    .limit(50);

  if (eventsError) {
    console.warn("\nCould not load system_event_log:", eventsError.message);
    return;
  }

  console.log("\n=== system_event_log (balance-sheet-integrity) ===");
  for (const event of events ?? []) {
    const tenants = (event.metadata as { tenants?: Array<{ tenantId?: string; tenantName?: string; imbalances?: Array<{ monthLabel: string; diff: number }> }> } | null)?.tenants ?? [];
    const caanta = tenants.find((row) => row.tenantId === TENANT_ID);
    if (!caanta) continue;

    const aug = caanta.imbalances?.find((row) => row.monthLabel === "Aug");
    console.log(
      `${event.created_at} | ${event.status} | Aug diff=${aug?.diff ?? "n/a"} | ${caanta.tenantName}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
