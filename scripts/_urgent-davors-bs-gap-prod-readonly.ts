/**
 * READ-ONLY urgent investigation: Davors production BS gap (FY2026).
 *
 *   npx tsx scripts/_urgent-davors-bs-gap-prod-readonly.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { BS_INTEGRITY_EVENT_NAME } from "../utils/balance-sheet-integrity-constants";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const YESTERDAY = "2026-08-23";

const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes(PRODUCTION_REF) || !key) {
    throw new Error("Refusing: production credentials required (.env.local.backup)");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  log(`=== Davors BS investigation (PRODUCTION ${PRODUCTION_REF}) ===`);
  log(`Tenant: ${DAVORS_TENANT_ID}`);
  log(`Focus date: ${YESTERDAY}`);
  log("");

  // --- 1) Month-by-month + FULL_YEAR ---
  log("--- 1) FY2026 month-by-month Balance Sheet check ---");
  const page = await fetchBalanceSheetPageData(admin, DAVORS_TENANT_ID, {
    dateRange: null,
  });
  if (page.fetchError) {
    throw new Error(`BS fetch error: ${page.fetchError}`);
  }

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
      tenantId: DAVORS_TENANT_ID,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );

  const imbalances: Array<{
    monthIndex: number;
    label: string;
    diff: number;
    assets: number;
    le: number;
  }> = [];

  for (let i = 0; i < 12; i += 1) {
    const check = getBalanceCheckForPeriod(report, i);
    const label = MONTH_LABELS[i] ?? `M${i + 1}`;
    const row = {
      monthIndex: i,
      label,
      diff: r2(check.difference),
      assets: r2(check.totalAssets),
      le: r2(check.totalLiabilitiesAndEquity),
    };
    log(
      `${label.padEnd(12)} idx=${i}  diff=${row.diff.toFixed(2)}  assets=${row.assets.toFixed(2)}  L+E=${row.le.toFixed(2)}  balanced=${check.isBalanced}`,
    );
    if (!check.isBalanced || Math.abs(row.diff) >= 0.01) {
      imbalances.push(row);
    }
  }

  const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
  const dec = getBalanceCheckForPeriod(report, 11);
  log("");
  log(
    `FULL_YEAR(idx12) diff=${r2(fy.difference).toFixed(2)} assets=${r2(fy.totalAssets).toFixed(2)} L+E=${r2(fy.totalLiabilitiesAndEquity).toFixed(2)} balanced=${fy.isBalanced}`,
  );
  log(
    `Dec vs FULL_YEAR gap (FULL_YEAR - Dec): ${r2(fy.difference - dec.difference).toFixed(2)}`,
  );
  log(`Imbalanced months (abs>=0.01): ${imbalances.length}`);
  if (imbalances.length) {
    const worst = imbalances.reduce((a, b) =>
      Math.abs(b.diff) > Math.abs(a.diff) ? b : a,
    );
    log(
      `Worst: ${worst.label} GHS ${Math.abs(worst.diff).toFixed(2)} (signed ${worst.diff.toFixed(2)})`,
    );
  }

  // Inventory opening config
  const inv = page.initialInventoryBalanceSheet;
  log("");
  log("--- Inventory opening config ---");
  log(
    JSON.stringify(
      {
        go_live_date: inv?.config?.go_live_date ?? null,
        opening_inventory_value: inv?.config?.opening_inventory_value ?? null,
        created_at: inv?.config?.created_at ?? null,
      },
      null,
      2,
    ),
  );

  // --- 2) What changed on 2026-08-23 ---
  log("");
  log(`--- 2) Rows dated ${YESTERDAY} (Davors) ---`);

  const [
    income,
    expense,
    manual,
    assets,
    stockMovements,
    productPurchases,
    rawPurchases,
    batches,
    apPayments,
    directorsLoan,
    payables,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "id, date, invoice_no, description, amount, amount_received, outstanding_balance, entry_type, payment_status, sale_status, is_system_adjustment, client_id, product_id, created_at, updated_at",
      )
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("date", YESTERDAY)
      .order("created_at", { ascending: true }),
    admin
      .from("expense_register")
      .select(
        "id, date, receipt_no, description, amount, expense_category, payment_status, vendor, client_op_id, created_at, updated_at",
      )
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("date", YESTERDAY)
      .order("created_at", { ascending: true }),
    admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("entry_date", YESTERDAY),
    admin
      .from("fixed_assets")
      .select("id, asset_name, purchase_date, purchase_cost, created_at, updated_at")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .or(`purchase_date.eq.${YESTERDAY},created_at.gte.${YESTERDAY}T00:00:00Z,updated_at.gte.${YESTERDAY}T00:00:00Z`),
    admin
      .from("stock_movements")
      .select("id, movement_type, quantity, unit_cost, movement_date, created_at, reference_id, product_id")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("movement_date", YESTERDAY),
    admin
      .from("product_purchases")
      .select("id, purchase_date, total_cost, payment_method, created_at, product_id")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("purchase_date", YESTERDAY),
    admin
      .from("raw_material_purchases")
      .select("id, purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("purchase_date", YESTERDAY),
    admin
      .from("production_batches")
      .select("id, batch_date, created_at, product_id, quantity_produced")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("batch_date", YESTERDAY),
    admin
      .from("accounts_payable_payments")
      .select("id, payment_date, amount, created_at, payable_id")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("payment_date", YESTERDAY),
    admin
      .from("directors_loan_repayments")
      .select("id, payment_date, amount, created_at")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("payment_date", YESTERDAY),
    admin
      .from("accounts_payable")
      .select("id, invoice_date, amount, amount_paid, balance_due, vendor_name, created_at, updated_at")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .or(`invoice_date.eq.${YESTERDAY},created_at.gte.${YESTERDAY}T00:00:00Z,updated_at.gte.${YESTERDAY}T00:00:00Z`),
  ]);

  const dump = (label: string, res: { data: unknown; error: { message: string } | null }) => {
    if (res.error) {
      log(`${label}: ERROR ${res.error.message}`);
      return;
    }
    const rows = (res.data as unknown[]) ?? [];
    log(`${label}: ${rows.length} row(s)`);
    for (const row of rows) {
      log(`  ${JSON.stringify(row)}`);
    }
  };

  dump("income_register", income);
  dump("expense_register", expense);
  dump("manual_financial_entries", manual);
  dump("fixed_assets (date/created/updated)", assets);
  dump("stock_movements", stockMovements);
  dump("product_purchases", productPurchases);
  dump("raw_material_purchases", rawPurchases);
  dump("production_batches", batches);
  dump("accounts_payable_payments", apPayments);
  dump("directors_loan_repayments", directorsLoan);
  dump("accounts_payable (touch)", payables);

  // Also: rows created/updated yesterday even if business date differs
  log("");
  log(`--- 2b) Rows created_at/updated_at on ${YESTERDAY} (any business date) ---`);
  const dayStart = `${YESTERDAY}T00:00:00.000Z`;
  const dayEnd = `2026-08-24T00:00:00.000Z`;

  const incomeTouch = await admin
    .from("income_register")
    .select(
      "id, date, invoice_no, description, amount, entry_type, is_system_adjustment, created_at, updated_at",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .or(
      `and(created_at.gte.${dayStart},created_at.lt.${dayEnd}),and(updated_at.gte.${dayStart},updated_at.lt.${dayEnd})`,
    )
    .order("created_at", { ascending: true });
  dump("income_register created/updated", incomeTouch);

  const expenseTouch = await admin
    .from("expense_register")
    .select(
      "id, date, receipt_no, description, amount, expense_category, created_at, updated_at",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .or(
      `and(created_at.gte.${dayStart},created_at.lt.${dayEnd}),and(updated_at.gte.${dayStart},updated_at.lt.${dayEnd})`,
    )
    .order("created_at", { ascending: true });
  dump("expense_register created/updated", expenseTouch);

  // System adjustment income
  const sysAdj = await admin
    .from("income_register")
    .select("id, date, invoice_no, description, amount, is_system_adjustment, updated_at")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("is_system_adjustment", true)
    .order("date", { ascending: true });
  log("");
  log("--- System-adjustment income (all) ---");
  dump("is_system_adjustment=true", sysAdj);

  // --- 3) Latest cron integrity status for Davors + platform sweep ---
  log("");
  log("--- 3) Latest BS integrity cron rows (Davors) ---");
  const cron = await admin
    .from("system_event_log")
    .select("status, metadata, created_at")
    .eq("event_name", BS_INTEGRITY_EVENT_NAME)
    .filter("metadata->>kind", "eq", "tenant")
    .filter("metadata->>tenantId", "eq", DAVORS_TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(5);
  if (cron.error) {
    log(`cron ERROR: ${cron.error.message}`);
  } else {
    for (const row of cron.data ?? []) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      log(
        `${row.created_at} status=${row.status} imbalanced=${meta.imbalancedMonthCount ?? meta.imbalances ?? "?"} worst=${meta.worstDiff ?? meta.maxAbsDiff ?? "?"} month=${meta.worstMonthLabel ?? "?"}`,
      );
      log(`  meta_keys=${Object.keys(meta).join(",")}`);
      if (meta.imbalances) {
        log(`  imbalances=${JSON.stringify(meta.imbalances)}`);
      }
    }
  }

  log("");
  log("--- 3b) Platform-wide FY2026 live sweep (imbalanced tenants only) ---");
  const { data: tenants } = await admin.from("tenants").select("id, name").order("name");
  const platformGaps: Array<{
    name: string;
    id: string;
    count: number;
    worst: number;
    worstLabel: string;
    fyDiff: number;
    decDiff: number;
  }> = [];

  for (const t of tenants ?? []) {
    const data = await fetchBalanceSheetPageData(admin, t.id, { dateRange: null });
    if (data.fetchError) {
      log(`${t.name}: FETCH ${data.fetchError}`);
      continue;
    }
    const rep = buildBalanceSheetReport(
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
        tenantId: t.id,
        accountsPayablePayments: data.initialAccountsPayablePayments,
        directorsLoanRepayments: data.initialDirectorsLoanRepayments,
      },
    );
    const monthGaps: Array<{ label: string; diff: number; idx: number }> = [];
    for (let i = 0; i < 12; i += 1) {
      const c = getBalanceCheckForPeriod(rep, i);
      const d = r2(c.difference);
      if (Math.abs(d) >= 0.01) {
        monthGaps.push({
          label: MONTH_LABELS[i] ?? `M${i + 1}`,
          diff: d,
          idx: i,
        });
      }
    }
    const fyC = getBalanceCheckForPeriod(rep, FULL_YEAR_INDEX);
    const decC = getBalanceCheckForPeriod(rep, 11);
    if (monthGaps.length > 0 || Math.abs(r2(fyC.difference)) >= 0.01) {
      const worst = monthGaps.reduce(
        (a, b) => (Math.abs(b.diff) > Math.abs(a.diff) ? b : a),
        monthGaps[0] ?? { label: "FULL_YEAR", diff: r2(fyC.difference), idx: 12 },
      );
      platformGaps.push({
        name: t.name,
        id: t.id,
        count: monthGaps.length,
        worst: Math.abs(worst.diff),
        worstLabel: worst.label,
        fyDiff: r2(fyC.difference),
        decDiff: r2(decC.difference),
      });
    }
  }

  platformGaps.sort((a, b) => b.worst - a.worst);
  log(`Tenants with any monthly/FY gap: ${platformGaps.length}`);
  for (const g of platformGaps) {
    log(
      `  ${g.name}: months=${g.count} worst=${g.worstLabel} ${g.worst.toFixed(2)} Dec=${g.decDiff.toFixed(2)} FY=${g.fyDiff.toFixed(2)} id=${g.id}`,
    );
  }

  const outPath = resolve(
    process.cwd(),
    "scripts/_urgent-davors-bs-gap-prod-readonly-out.txt",
  );
  writeFileSync(outPath, lines.join("\n"), "utf8");
  log("");
  log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
