// @ts-nocheck
/**
 * Read-only: inventory 38 source + July -2 residual decomposition.
 *   npx tsx --env-file .env.local.backup scripts/_probe-bs-residuals-38-and-2.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  calculateTotalInventoryValue,
  calculateInventoryByMonth,
  calculateInventoryOpeningEquityByMonth,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";

function loadEnv(filePath) {
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

loadEnv(resolve(".env.local.backup"));
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function main() {
  const inv = await fetchInventoryBalanceSheetInput(admin, TENANT);
  console.log("=== inventory_balance_config ===");
  console.log(inv.config);

  console.log("\n=== raw_materials ===");
  for (const m of inv.rawMaterials) {
    const stock = Number(m.current_stock) || 0;
    const cost = Number(m.average_cost_per_unit) || 0;
    console.log({
      name: m.material_name ?? m.name,
      id: m.id,
      stock,
      cost,
      value: r2(stock * cost),
    });
  }

  console.log("\n=== finished_products ===");
  for (const p of inv.finishedProducts) {
    const stock = Number(p.current_stock) || 0;
    const avg =
      inv.finishedProductAverageCosts.find((c) => c.product_id === p.id)
        ?.average_cost ?? 0;
    console.log({
      name: p.product_name ?? p.name,
      id: p.id,
      stock,
      avgCost: avg,
      value: r2(stock * avg),
    });
  }

  console.log("\n=== finishedProductAverageCosts ===");
  console.log(inv.finishedProductAverageCosts);

  const liveValue = calculateTotalInventoryValue(
    inv.rawMaterials,
    inv.finishedProducts,
    inv.finishedProductAverageCosts,
  );
  console.log("\nlive calculateTotalInventoryValue =", liveValue);

  const byMonth = calculateInventoryByMonth(
    inv.rawMaterials,
    inv.finishedProducts,
    inv.finishedProductAverageCosts,
    inv.config,
    FY,
  );
  console.log("calculateInventoryByMonth[0..6,FY]:", [
    ...byMonth.slice(0, 7),
    byMonth[12],
  ]);

  const openEq = calculateInventoryOpeningEquityByMonth(inv.config, FY);
  console.log("calculateInventoryOpeningEquityByMonth[0..6,FY]:", [
    ...openEq.slice(0, 7),
    openEq[12],
  ]);

  // product_purchases / raw purchases that might explain stock
  const { data: pp } = await admin
    .from("product_purchases")
    .select("*")
    .eq("tenant_id", TENANT);
  console.log("\n=== product_purchases ===");
  console.log(JSON.stringify(pp, null, 2));

  const { data: rp } = await admin
    .from("raw_material_purchases")
    .select("*")
    .eq("tenant_id", TENANT);
  console.log("\n=== raw_material_purchases ===");
  console.log(JSON.stringify(rp, null, 2));

  // Also try without tenant filter if RLS-shaped
  const { data: fpsAll } = await admin.from("finished_products").select("*");
  console.log("\nfinished_products raw count:", fpsAll?.length);
  console.log(JSON.stringify(fpsAll, null, 2));

  // Full BS for -2 analysis
  const [
    { data: incomeEntries },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: capitalContributions },
    { data: manualEntries },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndCloseRecords },
    { data: taxLedgerEntries },
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", TENANT),
    admin.from("expense_register").select("*").eq("tenant_id", TENANT),
    admin.from("fixed_assets").select("*").eq("tenant_id", TENANT),
    admin.from("accounts_payable").select("*").eq("tenant_id", TENANT),
    admin.from("capital_contributions").select("*").eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", TENANT),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT),
  ]);

  const cashFlow = (expenseEntries ?? []).map((e) => ({
    date: e.date,
    expense_category: e.expense_category,
    sub_category: e.sub_category,
    amount: Number(e.amount) || 0,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  const report = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlow,
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    FY,
    inv,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  console.log("\n=== Live gaps ===");
  for (const [label, idx] of [
    ["May", 4],
    ["June", 5],
    ["July", 6],
  ]) {
    console.log(label, getBalanceCheckForPeriod(report, idx));
  }

  // Line-level Assets - L+E contribution to gap
  console.log("\n=== July line contribution (signed: assets +, L/E -) ===");
  let rebuild = 0;
  for (const row of report.rows.filter((r) => r.kind === "data")) {
    const amt = r2(row.amounts[6]);
    const signed = row.side === "assets" ? amt : -amt;
    rebuild = r2(rebuild + signed);
    if (Math.abs(amt) >= 0.005) {
      console.log(
        `${row.side}\t${row.key}\t${amt}\tsigned_to_gap=${signed}`,
      );
    }
  }
  console.log("rebuild gap", rebuild);

  // Compare June vs July gap bridge at line level
  console.log("\n=== Gap bridge June→July (how each line changed the gap) ===");
  // gap = A - L - E; Δgap = ΔA - ΔL - ΔE
  let dGap = 0;
  for (const row of report.rows.filter((r) => r.kind === "data")) {
    const d = r2(row.amounts[6] - row.amounts[5]);
    if (Math.abs(d) < 0.005) continue;
    const effect = row.side === "assets" ? d : -d;
    dGap = r2(dGap + effect);
    console.log(
      `${row.key}: Δ=${d} effect_on_gap=${effect} (${row.side})`,
    );
  }
  console.log("sum effects", dGap, "actual Δgap", r2(
    getBalanceCheckForPeriod(report, 6).difference -
      getBalanceCheckForPeriod(report, 5).difference,
  ));

  // Zero out inventory asset hypothetically
  console.log("\n=== If inventory asset forced to 0 ===");
  const invZero = {
    ...inv,
    rawMaterials: [],
    finishedProducts: [],
    finishedProductAverageCosts: [],
  };
  const reportNoInv = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlow,
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    FY,
    invZero,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );
  console.log("June no-inv", getBalanceCheckForPeriod(reportNoInv, 5));
  console.log("July no-inv", getBalanceCheckForPeriod(reportNoInv, 6));

  // If opening equity set to 38
  const invWithOpen = {
    ...inv,
    config: inv.config
      ? { ...inv.config, opening_inventory_value: 38 }
      : null,
  };
  const reportOpen = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlow,
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    FY,
    invWithOpen,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );
  console.log("\n=== If opening_inventory_value=38 ===");
  console.log("opening equity months", calculateInventoryOpeningEquityByMonth(invWithOpen.config, FY).slice(0, 7));
  for (const [label, idx] of [
    ["Jan", 0],
    ["May", 4],
    ["June", 5],
    ["July", 6],
  ]) {
    const c = getBalanceCheckForPeriod(reportOpen, idx);
    const eq = reportOpen.rows.find((r) => r.key === "inventory-opening-equity");
    console.log(label, c, "openEqAmt", eq?.amounts[idx]);
  }

  // Search for 2.00 amounts
  console.log("\n=== Amounts exactly 2.00 or -2 ===");
  for (const r of incomeEntries ?? []) {
    for (const [k, v] of Object.entries(r)) {
      if (Math.abs(Number(v) - 2) < 0.001 && Number(v) !== 0) {
        console.log("income", r.invoice_no, k, v);
      }
    }
  }
  for (const r of expenseEntries ?? []) {
    for (const [k, v] of Object.entries(r)) {
      if (Math.abs(Number(v) - 2) < 0.001 && v != null && Number(v) !== 0) {
        console.log("expense", r.receipt_no || r.description, k, v, r.date);
      }
    }
  }
  for (const r of capitalContributions ?? []) {
    if (Math.abs(Number(r.amount) - 2) < 0.001) console.log("capital", r);
  }
  for (const a of fixedAssets ?? []) {
    const line = (Number(a.original_cost) || 0) * (Number(a.quantity) || 1);
    if (Math.abs(line - 2) < 0.001 || Math.abs(Number(a.original_cost) - 2) < 0.001) {
      console.log("FA", a.asset_name, a.original_cost, a.quantity, a.purchase_date);
    }
  }

  // Cent-level scan: any amounts with fractional cents issues?
  console.log("\n=== Values with >2 decimal raw (string) near payroll/tax ===");
  // Check if any BS line has non-cent precision before round
  console.log("July cash", report.rows.find((r) => r.key === "cash")?.amounts[6]);
  console.log("July RE", report.rows.find((r) => r.key === "retained-earnings")?.amounts[6]);
  console.log("July FA", report.rows.find((r) => r.key === "fixed-assets-net")?.amounts[6]);
  console.log("July AW", report.rows.find((r) => r.key === "accrued-wages-payable")?.amounts[6]);

  // FA July purchases total 87; capital excess over paid exp was 87
  // Cash June 0 July -40 — find the -40
  console.log("\n=== Cash June vs July ===");
  console.log("cash[5]", report.rows.find((r) => r.key === "cash")?.amounts[5]);
  console.log("cash[6]", report.rows.find((r) => r.key === "cash")?.amounts[6]);

  // Simulate opening equity properly cumulative?
  // Check share-capital: is it cumulative?
  console.log("\nshare-capital months", report.rows.find((r) => r.key === "share-capital")?.amounts.slice(0, 7));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
