/**
 * Staging verification: month-aware inventory BS valuation.
 *
 * Compares live-paint (legacy) vs history-based months, runs FY2026 integrity
 * for all staging tenants with inventory config, and prints Davors detail.
 *
 * Usage:
 *   npx tsx scripts/verify-inventory-month-aware-bs-staging.ts --env-file .env.staging.local
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  FULL_YEAR_INDEX,
  MONTH_LABELS,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  calculateInventoryByMonth,
  calculateInventoryByMonthFromLiveStock,
  calculateInventoryValueAsOf,
  calculateTotalInventoryValue,
  emptyInventoryValuationHistory,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_STAGING_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const FY = 2026;
/** Freeze "today" for reproducible Aug 2026 verification. */
const REF_DATE = new Date("2026-08-24T12:00:00.000Z");

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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseArgs() {
  let envFile = ".env.staging.local";
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--env-file" && process.argv[i + 1]) {
      envFile = process.argv[i + 1]!;
      i += 1;
    }
  }
  return { envFile };
}

async function detailTenant(
  admin: SupabaseClient,
  tenantId: string,
  label: string,
) {
  const t0 = Date.now();
  const data = await fetchBalanceSheetPageData(admin, tenantId, {
    dateRange: null,
  });
  const fetchMs = Date.now() - t0;

  const inv = data.initialInventoryBalanceSheet;
  const history = inv.valuationHistory ?? emptyInventoryValuationHistory();
  const liveValue = calculateTotalInventoryValue(
    inv.rawMaterials,
    inv.finishedProducts,
    inv.finishedProductAverageCosts,
  );
  const historyAsOfToday = calculateInventoryValueAsOf(
    history,
    inv.config,
    REF_DATE.toISOString().slice(0, 10),
  );

  const legacyMonths = calculateInventoryByMonthFromLiveStock(
    inv.rawMaterials,
    inv.finishedProducts,
    inv.finishedProductAverageCosts,
    inv.config,
    FY,
    REF_DATE,
  );
  const newMonths = calculateInventoryByMonth(
    history,
    inv.config,
    FY,
    REF_DATE,
  );

  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    { ...inv, referenceDate: REF_DATE },
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );

  const inventoryRow = report.rows.find((row) => row.key === "inventory");

  const monthRows = [];
  for (let m = 0; m < 12; m += 1) {
    const check = getBalanceCheckForPeriod(report, m);
    const invLine = inventoryRow
      ? getBalanceSheetAmountForMonth(inventoryRow, m)
      : 0;
    monthRows.push({
      month: MONTH_LABELS[m],
      legacyInv: r2(legacyMonths[m] ?? 0),
      newInv: r2(newMonths[m] ?? 0),
      bsInventory: r2(invLine),
      diff: r2(check.difference),
      balanced: check.isBalanced,
    });
  }
  const fyCheck = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
  const decCheck = getBalanceCheckForPeriod(report, 11);

  return {
    label,
    tenantId,
    goLive: inv.config?.go_live_date ?? null,
    openingEquity: Number(inv.config?.opening_inventory_value) || 0,
    liveValue: r2(liveValue),
    historyAsOfToday: r2(historyAsOfToday),
    liveVsHistoryGap: r2(liveValue - historyAsOfToday),
    fetchMs,
    historyCounts: {
      fpInflows: history.finishedProductInflows.length,
      fpCogs: history.finishedProductCogs.length,
      rmPurchases: history.rawMaterialPurchases.length,
      rmConsumptions: history.rawMaterialConsumptions.length,
    },
    months: monthRows,
    fullYearDiff: r2(fyCheck.difference),
    decemberDiff: r2(decCheck.difference),
    fullYearMatchesDecember: r2(fyCheck.difference) === r2(decCheck.difference),
    imbalancedMonths: monthRows.filter((r) => !r.balanced).map((r) => r.month),
  };
}

async function main() {
  const { envFile } = parseArgs();
  loadEnv(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!url.includes(STAGING_REF)) {
    throw new Error(
      `Refusing to run: expected staging ref ${STAGING_REF}, got ${url}`,
    );
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: configs, error: cfgErr } = await admin
    .from("inventory_balance_config")
    .select("tenant_id, go_live_date, opening_inventory_value");
  if (cfgErr) throw cfgErr;

  const { data: tenants, error: tErr } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");
  if (tErr) throw tErr;

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const inventoryTenantIds = [
    ...new Set((configs ?? []).map((c) => String(c.tenant_id))),
  ];

  console.log("=== Month-aware inventory BS verification (STAGING) ===");
  console.log(`FY ${FY} | refDate ${REF_DATE.toISOString().slice(0, 10)}`);
  console.log(`Inventory-config tenants: ${inventoryTenantIds.length}\n`);

  const details = [];
  for (const id of inventoryTenantIds) {
    const name = tenantName.get(id) ?? id;
    process.stdout.write(`… ${name} `);
    const row = await detailTenant(admin, id, name);
    console.log(
      `fetch ${row.fetchMs}ms | live=${row.liveValue} hist=${row.historyAsOfToday} gap=${row.liveVsHistoryGap} imbalanced=${row.imbalancedMonths.length}`,
    );
    details.push(row);
  }

  const davors =
    details.find((d) => d.tenantId === DAVORS_ID) ??
    (await detailTenant(admin, DAVORS_ID, "Davors Facilities (forced)"));
  const caanta = details.find((d) => d.tenantId === CAANTA_STAGING_ID);

  console.log("\n=== Davors month-by-month (legacy live-paint vs new history) ===");
  console.table(
    davors.months.map((m) => ({
      month: m.month,
      legacyInv: m.legacyInv,
      newInv: m.newInv,
      delta: r2(m.newInv - m.legacyInv),
      bsDiff: m.diff,
      ok: m.balanced,
    })),
  );
  console.log(
    JSON.stringify(
      {
        goLive: davors.goLive,
        liveValue: davors.liveValue,
        historyAsOfToday: davors.historyAsOfToday,
        liveVsHistoryGap: davors.liveVsHistoryGap,
        historyCounts: davors.historyCounts,
        fullYearDiff: davors.fullYearDiff,
        decemberDiff: davors.decemberDiff,
        fullYearMatchesDecember: davors.fullYearMatchesDecember,
      },
      null,
      2,
    ),
  );

  if (caanta) {
    console.log("\n=== Caanta staging FULL_YEAR vs December ===");
    console.log(
      JSON.stringify(
        {
          name: caanta.label,
          openingEquity: caanta.openingEquity,
          decemberDiff: caanta.decemberDiff,
          fullYearDiff: caanta.fullYearDiff,
          fullYearMatchesDecember: caanta.fullYearMatchesDecember,
          imbalancedMonths: caanta.imbalancedMonths,
        },
        null,
        2,
      ),
    );
  }

  console.log("\n=== Platform sweep (inventory tenants) ===");
  const sweep = details.map((d) => ({
    tenant: d.label,
    goLive: d.goLive,
    live: d.liveValue,
    hist: d.historyAsOfToday,
    gap: d.liveVsHistoryGap,
    imbalanced: d.imbalancedMonths.join(",") || "—",
    fyDiff: d.fullYearDiff,
    fyEqDec: d.fullYearMatchesDecember,
    fetchMs: d.fetchMs,
  }));
  console.table(sweep);

  const outPath = resolve(
    process.cwd(),
    "scripts/_verify-inventory-month-aware-bs-staging-out.json",
  );
  writeFileSync(
    outPath,
    JSON.stringify({ refDate: REF_DATE.toISOString(), davors, caanta, details }, null, 2),
  );
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
