/**
 * READ-ONLY: Staging Davors Aug 2026 44.90 gap deep dive
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const AUG = 7;
const JUL = 6;
const TARGET = 44.9;
const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  log("=== STAGING Davors 44.90 gap investigation ===");

  const page = await fetchBalanceSheetPageData(admin, DAVORS, { dateRange: null });
  const report = buildBalanceSheetReport(
    page.initialIncomeEntries,
    page.initialExpenseEntries,
    page.initialFixedAssets,
    page.initialPayableEntries,
    page.initialCapitalContributions,
    page.initialCashFlowExpenseEntries,
    page.initialPayrollHistory,
    page.initialMonthEndCloseNetPay,
    FY,
    page.initialInventoryBalanceSheet,
    page.initialManualEntries,
    page.initialTaxLedgerEntries,
    {
      tenantId: DAVORS,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );

  for (const idx of [JUL, AUG]) {
    const c = getBalanceCheckForPeriod(report, idx);
    log(`\n--- Month idx ${idx + 1}: diff=${r2(c.difference)} ---`);
    for (const row of report.rows) {
      if (row.kind === "section" || row.kind === "spacer") continue;
      const amt = r2(getBalanceSheetAmountForMonth(row, idx));
      if (Math.abs(amt) < 0.005) continue;
      log(`  ${row.kind.padEnd(10)} ${row.label}: ${amt.toFixed(2)}`);
    }
  }

  log("\n--- Jul→Aug row deltas ---");
  let assetDeltaSum = 0;
  let leDeltaSum = 0;
  for (const row of report.rows) {
    if (row.kind === "section" || row.kind === "spacer" || row.kind === "total") continue;
    const jul = r2(getBalanceSheetAmountForMonth(row, JUL));
    const aug = r2(getBalanceSheetAmountForMonth(row, AUG));
    const delta = r2(aug - jul);
    if (Math.abs(delta) < 0.005) continue;
    log(`  ${row.label} (${row.key}): ${delta.toFixed(2)}`);
    if (row.kind === "asset") assetDeltaSum += delta;
    if (row.kind === "liability" || row.kind === "equity") leDeltaSum += delta;
  }
  log(`Asset-side delta sum: ${r2(assetDeltaSum).toFixed(2)}`);
  log(`L+E delta sum: ${r2(leDeltaSum).toFixed(2)}`);
  log(`Implied new gap: ${r2(assetDeltaSum - leDeltaSum).toFixed(2)}`);

  log("\n--- Exact ±44.90 row matches (Aug) ---");
  for (const row of report.rows) {
    if (row.kind === "section" || row.kind === "spacer") continue;
    const amt = r2(getBalanceSheetAmountForMonth(row, AUG));
    if (Math.abs(Math.abs(amt) - TARGET) < 0.02) {
      log(`MATCH ${row.label} = ${amt.toFixed(2)}`);
    }
  }

  log("\n--- Inventory config ---");
  log(JSON.stringify(page.initialInventoryBalanceSheet?.config, null, 2));
  const inv = report.rows.find((r) => r.key === "inventory");
  const invEq = report.rows.find((r) => r.key === "inventory-opening-equity");
  log(`inventory Jul=${r2(getBalanceSheetAmountForMonth(inv!, JUL))} Aug=${r2(getBalanceSheetAmountForMonth(inv!, AUG))}`);
  log(`opening-equity Jul=${r2(getBalanceSheetAmountForMonth(invEq!, JUL))} Aug=${r2(getBalanceSheetAmountForMonth(invEq!, AUG))}`);

  log("\n--- System adjustment / DEDSAV income ---");
  const { data: sysAdj } = await admin
    .from("income_register")
    .select("id, date, invoice_no, description, amount, is_system_adjustment, entry_type, amount_received, outstanding_balance")
    .eq("tenant_id", DAVORS)
    .or("is_system_adjustment.eq.true,description.ilike.%dedsav%,description.ilike.%forfeit%");
  for (const row of sysAdj ?? []) log(`  ${JSON.stringify(row)}`);

  log("\n--- Aug income_register ---");
  const { data: augInc } = await admin
    .from("income_register")
    .select("*")
    .eq("tenant_id", DAVORS)
    .gte("date", "2026-08-01")
    .lte("date", "2026-08-31");
  for (const row of augInc ?? []) log(`  ${JSON.stringify(row)}`);

  log("\n--- tax_ledger Aug ---");
  const { data: tax } = await admin
    .from("tax_ledger_entries")
    .select("*")
    .eq("tenant_id", DAVORS)
    .gte("entry_date", "2026-08-01")
    .lte("entry_date", "2026-08-31");
  for (const row of tax ?? []) log(`  ${JSON.stringify(row)}`);

  log("\n--- client_invoices recent ---");
  const { data: invs } = await admin
    .from("client_invoices")
    .select("id, invoice_number, invoice_date, total_amount_due, status, updated_at")
    .eq("tenant_id", DAVORS)
    .order("updated_at", { ascending: false })
    .limit(10);
  for (const ci of invs ?? []) {
    log(`  ${JSON.stringify(ci)}`);
    const { data: legs } = await admin
      .from("tax_ledger_entries")
      .select("tax_component, direction, tax_amount, status")
      .eq("tenant_id", DAVORS)
      .eq("reference_id", ci.id);
    log(`    tax legs: ${legs?.length ?? 0} ${JSON.stringify(legs ?? [])}`);
  }

  log("\n--- Aug fixed_assets / purchases / AP ---");
  for (const [table, col] of [
    ["fixed_assets", "purchase_date"],
    ["raw_material_purchases", "purchase_date"],
    ["product_purchases", "purchase_date"],
    ["accounts_payable", "invoice_date"],
    ["expense_register", "date"],
  ] as const) {
    const { data } = await admin
      .from(table)
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte(col, "2026-08-01")
      .lte(col, "2026-08-31");
    log(`${table}: ${data?.length ?? 0}`);
    for (const row of data ?? []) log(`  ${JSON.stringify(row)}`);
  }

  log("\n--- AP payments all ---");
  const { data: apPay } = await admin
    .from("accounts_payable_payments")
    .select("*")
    .eq("tenant_id", DAVORS);
  for (const row of apPay ?? []) log(`  ${JSON.stringify(row)}`);

  const out = resolve(process.cwd(), "scripts/_probe-staging-davors-4490-out.txt");
  writeFileSync(out, lines.join("\n"), "utf8");
  log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
