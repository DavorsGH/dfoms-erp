/**
 * READ-ONLY urgent probe: FY2026 balance sheet status for ALL production tenants.
 * Does NOT write system_event_log or modify data.
 *
 * Usage:
 *   npx tsx scripts/_probe-fy2026-platform-bs-production-readonly.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  auditTenantBalanceSheetIntegrity,
  type TenantBalanceSheetIntegrityResult,
} from "../utils/balance-sheet-integrity";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import { calculateTotalInventoryValue } from "../app/dashboard/inventory/inventory-balance-sheet-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const CAANTA_ID = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";
const FY = 2026;
const REF_DATE = new Date("2026-12-31T23:59:59.000Z");

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

async function auditAllTenants(admin: SupabaseClient) {
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");
  if (error) throw error;

  const results: TenantBalanceSheetIntegrityResult[] = [];
  for (const tenant of tenants ?? []) {
    results.push(
      await auditTenantBalanceSheetIntegrity(admin, tenant, FY, REF_DATE),
    );
  }
  return results;
}

async function caantaDetail(admin: SupabaseClient) {
  const { data: cfg } = await admin
    .from("inventory_balance_config")
    .select("*")
    .eq("tenant_id", CAANTA_ID)
    .maybeSingle();

  const { data: rmPurchases } = await admin
    .from("raw_material_purchases")
    .select(
      "purchase_date, total_cost, payment_method, quantity, material_id, created_at",
    )
    .eq("tenant_id", CAANTA_ID)
    .gte("purchase_date", "2026-08-01")
    .order("purchase_date");

  const { data: productSales } = await admin
    .from("income_register")
    .select("date, amount, amount_received, entry_type, sale_status, description")
    .eq("tenant_id", CAANTA_ID)
    .eq("entry_type", "product_sale")
    .gte("date", "2026-08-01")
    .order("date");

  const data = await fetchBalanceSheetPageData(admin, CAANTA_ID, {
    dateRange: null,
  });
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
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId: CAANTA_ID,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );

  const decCheck = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
  const lines: Array<{ label: string; side: string; amount: number }> = [];
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    const amount = r2(getBalanceSheetAmountForMonth(row, FULL_YEAR_INDEX));
    if (Math.abs(amount) > 0.001) {
      lines.push({
        label: row.label,
        side: row.kind,
        amount,
      });
    }
  }

  const liveInv = calculateTotalInventoryValue(
    data.initialInventoryBalanceSheet.rawMaterials,
    data.initialInventoryBalanceSheet.finishedProducts,
    data.initialInventoryBalanceSheet.averageFinishedProductCosts,
  );

  const monthChecks = [];
  for (let m = 0; m < 12; m += 1) {
    const c = getBalanceCheckForPeriod(report, m);
    monthChecks.push({
      month: m + 1,
      diff: r2(c.difference),
      balanced: c.isBalanced,
      assets: r2(c.totalAssets),
      le: r2(c.totalLiabilitiesAndEquity),
    });
  }

  return {
    inventoryConfig: cfg,
    liveInventoryValue: r2(liveInv),
    rawMaterialPurchasesAugPlus: rmPurchases ?? [],
    rmPurchaseTotalAugPlus: r2(
      (rmPurchases ?? []).reduce((s, p) => s + (Number(p.total_cost) || 0), 0),
    ),
    productSalesAugPlus: productSales ?? [],
    monthChecks,
    decCheck: {
      diff: r2(decCheck.difference),
      assets: r2(decCheck.totalAssets),
      le: r2(decCheck.totalLiabilitiesAndEquity),
      balanced: decCheck.isBalanced,
    },
    decNonZeroLines: lines,
  };
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  loadEnv(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL: ${url}`);
  }
  if (!allowProduction) throw new Error("Pass --allow-production");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log(`\n=== FY${FY} platform BS audit (ref ${REF_DATE.toISOString().slice(0, 10)}) ===\n`);

  const results = await auditAllTenants(admin);

  console.log("Tenant | Status | Max |diff| | Imbalanced months");
  console.log("-".repeat(90));
  for (const r of results) {
    const months =
      r.imbalances.length === 0
        ? "none"
        : r.imbalances
            .map((x) => `${x.monthLabel.split(" ")[0]}=${x.diff.toFixed(2)}`)
            .join(", ");
    console.log(
      `${r.tenantName} | ${r.fetchError ? "FETCH_ERR" : r.status} | ${r.maxAbsDiff.toFixed(2)} | ${months}`,
    );
  }

  const newlyImbalanced = results.filter(
    (r) => !r.fetchError && r.imbalances.length > 0,
  );
  console.log(`\nTenants with any imbalance: ${newlyImbalanced.length}/${results.length}`);

  console.log("\n=== Caanta Market detail ===\n");
  const caanta = await caantaDetail(admin);
  console.log("inventory_balance_config:", caanta.inventoryConfig);
  console.log("live inventory asset (current):", caanta.liveInventoryValue);
  console.log(
    "raw_material_purchases Aug+ total:",
    caanta.rmPurchaseTotalAugPlus,
    `(${caanta.rawMaterialPurchasesAugPlus.length} rows)`,
  );
  console.log("raw_material_purchases Aug+:", caanta.rawMaterialPurchasesAugPlus);
  console.log("product_sales Aug+:", caanta.productSalesAugPlus);
  console.log("\nMonth-by-month diff:");
  for (const m of caanta.monthChecks) {
    console.log(
      `  M${String(m.month).padStart(2, "0")}: diff=${m.diff.toFixed(2)} assets=${m.assets.toFixed(2)} L+E=${m.le.toFixed(2)} balanced=${m.balanced}`,
    );
  }
  console.log("\nDec year-end check:", caanta.decCheck);
  console.log("\nDec non-zero BS lines:");
  for (const line of caanta.decNonZeroLines) {
    console.log(`  ${line.side.padEnd(10)} ${line.label}: ${line.amount.toFixed(2)}`);
  }

  const outPath = resolve(
    process.cwd(),
    "scripts/_probe-fy2026-platform-bs-production-readonly-out.json",
  );
  writeFileSync(
    outPath,
    JSON.stringify({ auditedAt: new Date().toISOString(), results, caanta }, null, 2),
  );
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
