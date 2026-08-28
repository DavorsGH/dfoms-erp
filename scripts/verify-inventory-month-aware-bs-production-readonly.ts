/**
 * READ-ONLY production probe: month-aware inventory BS (local code, no deploy).
 *
 * Usage:
 *   npx tsx scripts/verify-inventory-month-aware-bs-production-readonly.ts --env-file .env.local.backup --allow-production
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
  calculateFinishedProductValueAsOf,
  calculateInventoryByMonth,
  calculateInventoryByMonthFromLiveStock,
  calculateInventoryValueAsOf,
  calculateRawMaterialValueAsOf,
  calculateTotalInventoryValue,
  emptyInventoryValuationHistory,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_ID = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";
const FY = 2026;
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
  let envFile = ".env.local.backup";
  let allowProduction = false;
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--env-file" && process.argv[i + 1]) {
      envFile = process.argv[i + 1]!;
      i += 1;
    } else if (process.argv[i] === "--allow-production") {
      allowProduction = true;
    }
  }
  return { envFile, allowProduction };
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
    monthRows.push({
      month: MONTH_LABELS[m],
      legacyInv: r2(legacyMonths[m] ?? 0),
      newInv: r2(newMonths[m] ?? 0),
      bsInventory: inventoryRow
        ? r2(getBalanceSheetAmountForMonth(inventoryRow, m))
        : 0,
      diff: r2(check.difference),
      balanced: check.isBalanced,
    });
  }

  const fyCheck = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
  const decCheck = getBalanceCheckForPeriod(report, 11);
  const asOfs = ["2026-01-31", "2026-07-31", "2026-08-23", "2026-08-24"];
  const snaps = asOfs.map((d) => ({
    d,
    fp: r2(
      calculateFinishedProductValueAsOf(
        history.finishedProductInflows,
        history.finishedProductCogs,
        history.finishedProductInternalUse,
        inv.config,
        d,
      ),
    ),
    rm: r2(
      calculateRawMaterialValueAsOf(
        history.rawMaterialPurchases,
        history.rawMaterialConsumptions,
        inv.config,
        d,
      ),
    ),
    tot: r2(calculateInventoryValueAsOf(history, inv.config, d)),
  }));

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
    rmLines: (inv.rawMaterials ?? []).map((m) => ({
      name: m.material_name,
      stock: m.current_stock,
      avg: m.average_cost_per_unit,
      val: r2(
        (Number(m.current_stock) || 0) * (Number(m.average_cost_per_unit) || 0),
      ),
    })),
    fpLines: (inv.finishedProducts ?? []).map((p) => {
      const avg = (inv.finishedProductAverageCosts ?? []).find(
        (a) => a.product_id === p.id,
      );
      return {
        name: p.product_name,
        stock: p.current_stock,
        avg: avg?.average_cost ?? 0,
        val: r2((Number(p.current_stock) || 0) * (Number(avg?.average_cost) || 0)),
      };
    }),
    snaps,
    months: monthRows,
    fullYearDiff: r2(fyCheck.difference),
    decemberDiff: r2(decCheck.difference),
    fullYearMatchesDecember:
      r2(fyCheck.difference) === r2(decCheck.difference),
    imbalancedMonths: monthRows.filter((r) => !r.balanced).map((r) => r.month),
  };
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  if (!allowProduction) {
    throw new Error("Pass --allow-production for this read-only production probe");
  }
  loadEnv(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Expected production ref ${PRODUCTION_REF}`);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: configs, error: cfgErr } = await admin
    .from("inventory_balance_config")
    .select("tenant_id");
  if (cfgErr) throw cfgErr;
  const { data: tenants, error: tErr } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");
  if (tErr) throw tErr;

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const ids = [...new Set((configs ?? []).map((c) => String(c.tenant_id)))];

  console.log("=== Month-aware inventory BS (PRODUCTION READ-ONLY, local code) ===");
  console.log(`FY ${FY} | refDate ${REF_DATE.toISOString().slice(0, 10)}`);
  console.log(`Inventory-config tenants: ${ids.length}\n`);

  const details = [];
  for (const id of ids) {
    const name = tenantName.get(id) ?? id;
    process.stdout.write(`… ${name} `);
    const row = await detailTenant(admin, id, name);
    console.log(
      `fetch ${row.fetchMs}ms | live=${row.liveValue} hist=${row.historyAsOfToday} gap=${row.liveVsHistoryGap} imbalanced=${row.imbalancedMonths.length}`,
    );
    details.push(row);
  }

  const davors = details.find((d) => d.tenantId === DAVORS_ID)!;
  const caanta = details.find((d) => d.tenantId === CAANTA_ID);

  console.log("\n=== Davors before/after (legacy live-paint vs new history) ===");
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
        rmLines: davors.rmLines,
        fpLines: davors.fpLines,
        snaps: davors.snaps,
        fullYearDiff: davors.fullYearDiff,
        decemberDiff: davors.decemberDiff,
        fullYearMatchesDecember: davors.fullYearMatchesDecember,
        imbalancedMonths: davors.imbalancedMonths,
      },
      null,
      2,
    ),
  );

  if (caanta) {
    console.log("\n=== Caanta production FULL_YEAR vs December ===");
    console.log(
      JSON.stringify(
        {
          name: caanta.label,
          openingEquity: caanta.openingEquity,
          liveValue: caanta.liveValue,
          historyAsOfToday: caanta.historyAsOfToday,
          decemberDiff: caanta.decemberDiff,
          fullYearDiff: caanta.fullYearDiff,
          fullYearMatchesDecember: caanta.fullYearMatchesDecember,
          imbalancedMonths: caanta.imbalancedMonths,
          months: caanta.months.map((m) => ({
            month: m.month,
            newInv: m.newInv,
            diff: m.diff,
            ok: m.balanced,
          })),
        },
        null,
        2,
      ),
    );
  }

  console.log("\n=== Platform sweep (inventory tenants) ===");
  console.table(
    details.map((d) => ({
      tenant: d.label,
      goLive: d.goLive,
      live: d.liveValue,
      hist: d.historyAsOfToday,
      gap: d.liveVsHistoryGap,
      imbalanced: d.imbalancedMonths.join(",") || "—",
      fyDiff: d.fullYearDiff,
      fyEqDec: d.fullYearMatchesDecember,
      fetchMs: d.fetchMs,
    })),
  );

  const outPath = resolve(
    process.cwd(),
    "scripts/_verify-inventory-month-aware-bs-production-out.json",
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
