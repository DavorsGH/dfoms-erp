/**
 * READ-ONLY: Davors Aug 2026 BS gap line attribution (~44.90).
 *
 *   npx tsx scripts/_probe-davors-aug2026-bs-4490-readonly.ts
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
  getBalanceSheetForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const AUG = 7;
const TARGET = 44.9;
const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes(PRODUCTION_REF) || !key) {
    throw new Error("Production .env.local.backup required");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  log("=== Davors Aug 2026 BS gap investigation (READ-ONLY) ===");

  const page = await fetchBalanceSheetPageData(admin, DAVORS, { dateRange: null });
  if (page.fetchError) throw new Error(page.fetchError);

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

  const check = getBalanceCheckForPeriod(report, AUG);
  log(
    `Aug balance check: diff=${r2(check.difference)} assets=${r2(check.totalAssets)} L+E=${r2(check.totalLiabilitiesAndEquity)} balanced=${check.isBalanced}`,
  );
  log(`Widget would show: Out of balance by GHS ${Math.abs(r2(check.difference)).toFixed(2)}`);

  log("\n--- Aug line-by-line (Assets / Liabilities / Equity) ---");
  const monthRows = getBalanceSheetForMonth(report, AUG);
  let assetSum = 0;
  let leSum = 0;
  for (const row of monthRows) {
    if (row.kind === "section" || row.kind === "spacer" || row.kind === "total") {
      log(`[${row.kind}] ${row.label}`);
      continue;
    }
    const amt = r2(row.amount);
    if (Math.abs(amt) < 0.005) continue;
    log(`  ${row.kind.padEnd(12)} ${row.label}: ${amt.toFixed(2)}`);
    if (row.kind === "asset") assetSum += amt;
    if (row.kind === "liability" || row.kind === "equity") leSum += amt;
  }
  log(`Manual asset sum (non-total rows): ${r2(assetSum)}`);
  log(`Manual L+E sum (non-total rows): ${r2(leSum)}`);
  log(`Manual gap: ${r2(assetSum - leSum)}`);

  log("\n--- Rows with amount near ±44.90 in Aug ---");
  for (const row of report.rows) {
    if (row.kind === "section" || row.kind === "spacer") continue;
    const amt = r2(getBalanceSheetAmountForMonth(row, AUG));
    if (Math.abs(Math.abs(amt) - TARGET) < 0.02) {
      log(`MATCH ${row.kind} ${row.label} (${row.key}) = ${amt.toFixed(2)}`);
    }
  }

  log("\n--- Month-over-month deltas Aug vs Jul (|delta| >= 1) ---");
  for (const row of report.rows) {
    if (row.kind === "section" || row.kind === "spacer") continue;
    const jul = r2(getBalanceSheetAmountForMonth(row, 6));
    const aug = r2(getBalanceSheetAmountForMonth(row, AUG));
    const delta = r2(aug - jul);
    if (Math.abs(delta) >= 1) {
      log(`  ${row.label} (${row.key}): Jul=${jul.toFixed(2)} Aug=${aug.toFixed(2)} delta=${delta.toFixed(2)}`);
    }
  }

  // Pattern 1: system adjustment / DEDSAV / forfeit income
  log("\n--- Pattern 1: income_register anomalies (Aug 2026) ---");
  const { data: augIncome } = await admin
    .from("income_register")
    .select(
      "id, date, invoice_no, description, amount, amount_received, outstanding_balance, entry_type, payment_status, sale_status, is_system_adjustment, service_category, wht_amount, output_vat_amount, net_of_tax_amount, client_id, created_at, updated_at",
    )
    .eq("tenant_id", DAVORS)
    .gte("date", `${FY}-08-01`)
    .lte("date", `${FY}-08-31`)
    .order("date", { ascending: true });

  for (const row of augIncome ?? []) {
    const desc = String(row.description ?? "").toLowerCase();
    const flagged =
      row.is_system_adjustment === true ||
      desc.includes("dedsav") ||
      desc.includes("forfeit") ||
      desc.includes("deduction") ||
      desc.includes("payroll") ||
      row.entry_type !== "invoice";
    if (flagged || Math.abs(Number(row.amount) - TARGET) < 0.02) {
      log(`  ${JSON.stringify(row)}`);
    }
  }

  const { data: sysAdjAll } = await admin
    .from("income_register")
    .select("id, date, invoice_no, description, amount, is_system_adjustment, updated_at")
    .eq("tenant_id", DAVORS)
    .eq("is_system_adjustment", true);
  log(`System-adjustment income rows (all dates): ${sysAdjAll?.length ?? 0}`);
  for (const row of sysAdjAll ?? []) {
    log(`  ${JSON.stringify(row)}`);
  }

  const { data: dedsavLike } = await admin
    .from("income_register")
    .select("id, date, invoice_no, description, amount, is_system_adjustment, entry_type")
    .eq("tenant_id", DAVORS)
    .or("description.ilike.%dedsav%,description.ilike.%forfeit%,description.ilike.%deduction saving%");
  log(`DEDSAV/forfeit-like income: ${dedsavLike?.length ?? 0}`);
  for (const row of dedsavLike ?? []) {
    log(`  ${JSON.stringify(row)}`);
  }

  // Pattern 2: tax ledger sync
  log("\n--- Pattern 2: tax_ledger_entries Aug + recent client invoices ---");
  const { data: augTax } = await admin
    .from("tax_ledger_entries")
    .select("*")
    .eq("tenant_id", DAVORS)
    .gte("entry_date", `${FY}-08-01`)
    .lte("entry_date", `${FY}-08-31`)
    .order("entry_date", { ascending: true });
  log(`Aug tax_ledger_entries: ${augTax?.length ?? 0}`);
  for (const row of augTax ?? []) {
    log(`  ${row.entry_date} ${row.tax_component} ${row.direction} ${row.tax_amount} status=${row.status} ref=${row.reference_type ?? ""}/${row.reference_id ?? ""}`);
  }

  const { data: recentInvoices } = await admin
    .from("client_invoices")
    .select("id, invoice_number, invoice_date, total_amount_due, status, updated_at, created_at")
    .eq("tenant_id", DAVORS)
    .gte("updated_at", "2026-08-01T00:00:00Z")
    .order("updated_at", { ascending: false })
    .limit(20);
  log("Recent client_invoices updated since Aug 1:");
  for (const inv of recentInvoices ?? []) {
    log(`  ${JSON.stringify(inv)}`);
    const { data: taxForInv } = await admin
      .from("tax_ledger_entries")
      .select("id, tax_component, direction, tax_amount, status, entry_date")
      .eq("tenant_id", DAVORS)
      .eq("reference_id", inv.id);
    const expectedLegs = 2;
    if ((taxForInv?.length ?? 0) < expectedLegs) {
      log(`    WARNING: only ${taxForInv?.length ?? 0} tax leg(s) for invoice ${inv.invoice_number}`);
    }
    for (const t of taxForInv ?? []) {
      log(`    tax: ${JSON.stringify(t)}`);
    }
  }

  const { data: augIncomeTouch } = await admin
    .from("income_register")
    .select("id, date, invoice_no, description, amount, wht_amount, output_vat_amount, updated_at")
    .eq("tenant_id", DAVORS)
    .gte("updated_at", "2026-08-01T00:00:00Z")
    .order("updated_at", { ascending: false })
    .limit(30);
  log("\nIncome register updated since Aug 1:");
  for (const row of augIncomeTouch ?? []) {
    log(`  ${JSON.stringify(row)}`);
  }

  // Pattern 3: inventory
  log("\n--- Pattern 3: inventory valuation ---");
  const inv = page.initialInventoryBalanceSheet;
  log(
    JSON.stringify(
      {
        go_live_date: inv?.config?.go_live_date,
        opening_inventory_value: inv?.config?.opening_inventory_value,
      },
      null,
      2,
    ),
  );
  const invRow = report.rows.find((r) => r.key === "inventory");
  const invEquityRow = report.rows.find((r) => r.key === "inventory-opening-equity");
  log(
    `inventory Aug=${r2(getBalanceSheetAmountForMonth(invRow!, AUG))} Jul=${r2(getBalanceSheetAmountForMonth(invRow!, 6))}`,
  );
  log(
    `inventory-opening-equity Aug=${r2(getBalanceSheetAmountForMonth(invEquityRow!, AUG))} Jul=${r2(getBalanceSheetAmountForMonth(invEquityRow!, 6))}`,
  );

  // Pattern 4: manual / FA / purchases Aug
  log("\n--- Pattern 4: Aug activity (manual, FA, purchases, AP) ---");
  const tables = [
    ["manual_financial_entries", "entry_date"],
    ["fixed_assets", "purchase_date"],
    ["raw_material_purchases", "purchase_date"],
    ["product_purchases", "purchase_date"],
    ["accounts_payable", "invoice_date"],
    ["expense_register", "date"],
  ] as const;

  for (const [table, dateCol] of tables) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .eq("tenant_id", DAVORS)
      .gte(dateCol, `${FY}-08-01`)
      .lte(dateCol, `${FY}-08-31`);
    if (error) {
      log(`${table}: ERROR ${error.message}`);
      continue;
    }
    log(`${table}: ${data?.length ?? 0} Aug row(s)`);
    for (const row of data ?? []) {
      log(`  ${JSON.stringify(row)}`);
    }
  }

  // Pairing check: Aug expenses ~44.90 without cash/AP mirror
  log("\n--- Aug expenses near 44.90 ---");
  for (const row of page.initialExpenseEntries.filter((e) => {
    const d = e.date?.slice(0, 10);
    return d >= `${FY}-08-01` && d <= `${FY}-08-31`;
  })) {
    const amt = r2(Number(row.amount) || 0);
    if (Math.abs(Math.abs(amt) - TARGET) < 0.02) {
      log(`  expense: ${JSON.stringify(row)}`);
    }
  }

  const out = resolve(process.cwd(), "scripts/_probe-davors-aug2026-bs-4490-out.txt");
  writeFileSync(out, lines.join("\n"), "utf8");
  log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
