// @ts-nocheck
/**
 * Bridge June→July gap; verify forfeit notes vs missing income; inventory equity.
 *   npx tsx --env-file .env.local.backup scripts/_probe-july-86-gap3.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  mergePayrollWagesSources,
  parseCashPaidFromExpenseNotes,
  parseWagesForfeitedFromExpenseNotes,
} from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import { buildProfitLossReport } from "../app/dashboard/finance/profit-loss-utils";

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
    inventoryBalanceSheet,
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", TENANT),
    admin.from("expense_register").select("*").eq("tenant_id", TENANT),
    admin.from("fixed_assets").select("*").eq("tenant_id", TENANT),
    admin.from("accounts_payable").select("*").eq("tenant_id", TENANT),
    admin.from("capital_contributions").select("*").eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin.from("payroll_history").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", TENANT),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);

  // PAYROLL-SAL notes
  const sal = (expenseEntries ?? []).filter((e) =>
    String(e.receipt_no ?? "").startsWith("PAYROLL-SAL"),
  );
  console.log("=== PAYROLL-SAL rows ===");
  for (const e of sal) {
    console.log({
      receipt: e.receipt_no,
      date: e.date,
      amount: e.amount,
      status: e.payment_status,
      notes: e.notes,
      cash_paid: parseCashPaidFromExpenseNotes(e.notes),
      forfeited: parseWagesForfeitedFromExpenseNotes(e.notes),
    });
  }

  // Search any income ~88.09 or forfeit-like ever
  console.log("\n=== All income (full) ===");
  for (const r of incomeEntries ?? []) {
    console.log({
      id: r.id,
      date: r.date,
      inv: r.invoice_no,
      amt: r.amount,
      out: r.outstanding_balance,
      recv: r.amount_received,
      cat: r.service_category,
      status: r.payment_status,
      client: r.client_id,
      desc: r.description,
      notes: r.notes,
    });
  }

  // Inventory config
  console.log("\n=== Inventory BS input summary ===");
  console.log({
    rawMaterials: inventoryBalanceSheet?.rawMaterials?.length,
    finishedProducts: inventoryBalanceSheet?.finishedProducts?.length,
    batchSummaries: inventoryBalanceSheet?.batchSummaries?.length,
    config: inventoryBalanceSheet?.config,
    referenceDate: inventoryBalanceSheet?.referenceDate,
  });

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
    inventoryBalanceSheet,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  console.log("\n=== Component bridge June→July ===");
  console.log(
    "line".padEnd(28),
    "June".padStart(12),
    "July".padStart(12),
    "Δ".padStart(12),
    "side",
  );
  for (const row of report.rows.filter((r) => r.kind === "data")) {
    const j = r2(row.amounts[5]);
    const u = r2(row.amounts[6]);
    const d = r2(u - j);
    console.log(
      String(row.key).padEnd(28),
      j.toFixed(2).padStart(12),
      u.toFixed(2).padStart(12),
      d.toFixed(2).padStart(12),
      row.side,
    );
  }

  const june = getBalanceCheckForPeriod(report, 5);
  const july = getBalanceCheckForPeriod(report, 6);
  console.log("\nJune check", june);
  console.log("July check", july);
  console.log("Gap change June→July", r2(july.difference - june.difference));

  // Simulate: add back missing forfeit income 88.09 as Other Income, outstanding 0
  const withForfeit = [
    ...(incomeEntries ?? []),
    {
      id: "sim-forfeit",
      date: "2026-06-30",
      invoice_no: "SIM-FORFEIT-88.09",
      amount: 88.09,
      amount_received: 0,
      outstanding_balance: 0,
      wht_amount: 0,
      service_category: "Other Income",
      entry_type: "service",
      sale_status: "active",
      net_of_tax_amount: 88.09,
      output_vat_amount: 0,
      payment_status: "Unpaid",
      description: "SIM missing forfeit",
    },
  ];
  const reportF = buildBalanceSheetReport(
    withForfeit,
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlow,
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    FY,
    inventoryBalanceSheet,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );
  console.log("\n=== After SIM forfeit income 88.09 (outstd=0) ===");
  console.log("June", getBalanceCheckForPeriod(reportF, 5));
  console.log("July", getBalanceCheckForPeriod(reportF, 6));

  // Simulate: also zero inventory (or add opening equity 38)
  // Check inventory-opening-equity line
  const invEq = report.rows.find((r) => r.key === "inventory-opening-equity");
  const inv = report.rows.find((r) => r.key === "inventory");
  console.log("\nInventory asset by month:", inv?.amounts?.slice(0, 7));
  console.log("Inventory opening equity by month:", invEq?.amounts?.slice(0, 7));

  // Sim forfeit + inventory opening equity 38
  // How does inventory opening equity get set? via config
  console.log("\n=== Sim forfeit only residual after inventory strip ===");
  const jF = getBalanceCheckForPeriod(reportF, 5);
  const uF = getBalanceCheckForPeriod(reportF, 6);
  console.log("June gap - 38 inventory =", r2(jF.difference - 38));
  console.log("July gap - 38 inventory =", r2(uF.difference - 38));
  console.log("Live June gap - 38 =", r2(june.difference - 38));
  console.log("Live July gap - 38 =", r2(july.difference - 38));

  // P&L Other Income July
  const pl = buildProfitLossReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    FY,
  );
  console.log("\n=== P&L rows involving Other / revenue (July amounts) ===");
  for (const row of pl.rows ?? []) {
    if (row.kind !== "data") continue;
    const amt = r2(row.amounts?.[6] ?? 0);
    if (Math.abs(amt) > 0.005) {
      console.log(row.key || row.label, amt);
    }
  }

  // What if we remove DEDSAV from income - does July gap become 86.09+85.76=171.85?
  const withoutDedsav = (incomeEntries ?? []).filter(
    (r) => r.invoice_no !== "PAYROLL-DEDSAV-2026-07",
  );
  const reportNoDed = buildBalanceSheetReport(
    withoutDedsav,
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlow,
    mergePayrollWagesSources(payrollHistory ?? [], payrollProcessing ?? []),
    monthEndCloseRecords ?? [],
    FY,
    inventoryBalanceSheet,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );
  console.log("\n=== Without DEDSAV ===");
  console.log("June", getBalanceCheckForPeriod(reportNoDed, 5));
  console.log("July", getBalanceCheckForPeriod(reportNoDed, 6));

  // Hypothetical: missing forfeit is THE 88.09; inventory is 38; DEDSAV closed 85.76 of something else?
  // Live July residual after removing inventory & forfeit effect:
  console.log("\n=== Decomposition ===");
  console.log("May gap (inventory-only baseline):", getBalanceCheckForPeriod(report, 4));
  console.log("88.09 forfeit missing + 38 inventory =", r2(88.09 + 38));
  console.log("Expected June if those two only:", 126.09);
  console.log(
    "July live - inventory38 - forfeit88.09 + DEDSAV effect on RE:",
  );
  console.log(
    "  If DEDSAV adds 85.76 equity: expected July gap = 126.09 - 85.76 =",
    r2(126.09 - 85.76),
  );
  console.log("  Actual July gap:", july.difference);
  console.log(
    "  Unexplained July residual vs that expectation:",
    r2(july.difference - (126.09 - 85.76)),
  );

  // Check FA depreciation / net book - any July purchase missing capital?
  console.log("\n=== Fixed assets purchase dates ===");
  for (const a of fixedAssets ?? []) {
    const cost = (Number(a.original_cost) || 0) * (Number(a.quantity) || 1);
    if (String(a.purchase_date).startsWith("2026")) {
      console.log({
        name: a.asset_name,
        purchase: a.purchase_date,
        cost,
        life: a.useful_life_years,
        method: a.depreciation_method,
      });
    }
  }

  // Capital contributions all
  console.log("\n=== All capital contributions ===");
  for (const c of capitalContributions ?? []) {
    console.log(c);
  }

  // Manual share capital / vat - how applied?
  console.log("\n=== Manual entry effect on BS lines ===");
  const sc = report.rows.find((r) => r.key === "share-capital");
  console.log("share-capital months 0-6:", sc?.amounts?.slice(0, 7));
  console.log(
    "manual share_capital field:",
    manualEntries?.[0]?.share_capital,
  );
  console.log("manual vat_payable field:", manualEntries?.[0]?.vat_payable);
  const vatPay = report.rows.find((r) => r.key === "net-vat-payable");
  console.log("net-vat-payable months:", vatPay?.amounts?.slice(0, 7));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
