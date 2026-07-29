// @ts-nocheck
/**
 * Diagnostic-only: July ~86.09 BS gap vs June.
 *   npx tsx --env-file .env.local.backup scripts/_probe-july-86-gap.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

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

loadEnv(resolve(".env.local.backup"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error(`Not production: ${url}`);
}

const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const TARGETS = [
  86.09, 86.1, 86, 85.76, 43.045, 43.05, 172.18, 172.2, 126.09, 171.85, 88.09,
];

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function nearTarget(n: number, tol = 0.02) {
  const v = r2(n);
  return TARGETS.some((t) => Math.abs(v - t) <= tol);
}

async function load() {
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
    admin
      .from("income_register")
      .select(
        "id, date, invoice_no, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount, customer_name, client_id, description, payment_status, notes, created_at, updated_at",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("expense_register")
      .select(
        "id, date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount, vendor",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("fixed_assets")
      .select(
        "id, asset_name, original_cost, quantity, useful_life_years, purchase_date, depreciation_method, asset_category",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("accounts_payable")
      .select(
        "id, invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select(
        "payroll_month, net_pay, net_only_adjustment, gross_pay, absence_deduction, loan_repayment, salary_advance, welfare_deduction, other_deductions",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", TENANT),
    admin
      .from("tax_ledger_entries")
      .select(
        "id, entry_date, period_month, direction, tax_component, tax_amount, status, source_type, source_id, notes, counterparty_name",
      )
      .eq("tenant_id", TENANT),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);

  return {
    incomeEntries: incomeEntries ?? [],
    expenseEntries: expenseEntries ?? [],
    fixedAssets: fixedAssets ?? [],
    payableEntries: payableEntries ?? [],
    capitalContributions: capitalContributions ?? [],
    manualEntries: manualEntries ?? [],
    payrollHistory: payrollHistory ?? [],
    payrollProcessing: payrollProcessing ?? [],
    monthEndCloseRecords: monthEndCloseRecords ?? [],
    taxLedgerEntries: taxLedgerEntries ?? [],
    inventoryBalanceSheet,
  };
}

async function main() {
const data = await load();
const cashFlow = data.expenseEntries.map((e) => ({
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
  data.incomeEntries,
  data.expenseEntries,
  data.fixedAssets,
  data.payableEntries,
  data.capitalContributions,
  cashFlow,
  mergePayrollWagesSources(data.payrollHistory, data.payrollProcessing),
  data.monthEndCloseRecords,
  FY,
  data.inventoryBalanceSheet,
  data.manualEntries,
  data.taxLedgerEntries,
);

const may = getBalanceCheckForPeriod(report, 4);
const june = getBalanceCheckForPeriod(report, 5);
const july = getBalanceCheckForPeriod(report, 6);
const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);

console.log("=== 1. ENGINE GAPS ===");
console.log(
  JSON.stringify(
    {
      May: may,
      June: june,
      July: july,
      FY: fy,
    },
    null,
    2,
  ),
);

console.log("\n=== 2. FULL JULY COMPONENT BREAKDOWN ===");
let assetsSum = 0;
let leSum = 0;
for (const row of report.rows) {
  if (row.kind !== "data") {
    console.log(`[${row.kind}] ${row.label}`);
    continue;
  }
  const amt = r2(row.amounts[6]);
  const side = row.side ?? "?";
  if (side === "assets") assetsSum = r2(assetsSum + amt);
  if (side === "liabilities" || side === "equity") leSum = r2(leSum + amt);
  console.log(
    `${String(side).padEnd(12)} ${String(row.key).padEnd(28)} ${String(row.label).padEnd(42)} ${amt.toFixed(2)}`,
  );
}
console.log(
  `\nSum data assets lines=${assetsSum.toFixed(2)}  report.totalAssets[6]=${r2(report.totalAssets[6]).toFixed(2)}`,
);
console.log(
  `Sum data L/E lines=${leSum.toFixed(2)}  report.totalL+E[6]=${r2(report.totalLiabilitiesAndEquity[6]).toFixed(2)}`,
);
console.log(`Difference=${r2(assetsSum - leSum).toFixed(2)}`);

console.log("\n=== LINE DELTAS June→July (nonzero) ===");
for (const row of report.rows.filter((r) => r.kind === "data")) {
  const d = r2(row.amounts[6] - row.amounts[5]);
  if (Math.abs(d) >= 0.005) {
    console.log(
      `${row.key}: ${r2(row.amounts[5]).toFixed(2)} → ${r2(row.amounts[6]).toFixed(2)}  Δ=${d.toFixed(2)}`,
    );
  }
}

console.log("\n=== JUNE FULL COMPONENT (for compare) ===");
for (const row of report.rows.filter((r) => r.kind === "data")) {
  const amt = r2(row.amounts[5]);
  if (Math.abs(amt) >= 0.005) {
    console.log(
      `${String(row.side).padEnd(12)} ${String(row.key).padEnd(28)} ${amt.toFixed(2)}`,
    );
  }
}

console.log("\n=== 3. TRANSACTIONS NEAR TARGET AMOUNTS ===");

function scan(rows: any[], pick: (r: any) => Record<string, unknown>) {
  const hits: any[] = [];
  for (const row of rows) {
    const fields = pick(row);
    for (const [fname, val] of Object.entries(fields)) {
      if (val == null || val === "") continue;
      const num = Number(val);
      if (!Number.isFinite(num)) continue;
      if (nearTarget(num)) {
        hits.push({ fname, val: r2(num), row });
      }
    }
  }
  return hits;
}

const incomeHits = scan(data.incomeEntries, (r) => ({
  amount: r.amount,
  amount_received: r.amount_received,
  outstanding_balance: r.outstanding_balance,
  net_of_tax_amount: r.net_of_tax_amount,
  output_vat_amount: r.output_vat_amount,
  wht_amount: r.wht_amount,
}));
const expenseHits = scan(data.expenseEntries, (r) => ({
  amount: r.amount,
  net_of_tax_amount: r.net_of_tax_amount,
  input_vat_amount: r.input_vat_amount,
}));
const capitalHits = scan(data.capitalContributions, (r) => ({
  amount: r.amount,
}));
const faHits = scan(data.fixedAssets, (r) => ({
  original_cost: r.original_cost,
  line: (Number(r.original_cost) || 0) * (Number(r.quantity) || 1),
}));
const apHits = scan(data.payableEntries, (r) => ({
  amount: r.amount,
  amount_paid: r.amount_paid,
  balance_due: r.balance_due,
}));
const taxHits = scan(data.taxLedgerEntries, (r) => ({
  tax_amount: r.tax_amount,
}));

console.log(`\n-- income_register n=${incomeHits.length} --`);
for (const h of incomeHits) {
  console.log(
    `${h.fname}=${h.val} date=${h.row.date} inv=${h.row.invoice_no} cat=${h.row.service_category} status=${h.row.payment_status} outstd=${h.row.outstanding_balance} amt_recv=${h.row.amount_received} desc=${String(h.row.description ?? "").slice(0, 70)}`,
  );
}
console.log(`\n-- expense_register n=${expenseHits.length} --`);
for (const h of expenseHits) {
  console.log(
    `${h.fname}=${h.val} date=${h.row.date} receipt=${h.row.receipt_no} cat=${h.row.expense_category} status=${h.row.payment_status} desc=${String(h.row.description ?? "").slice(0, 70)}`,
  );
}
console.log(`\n-- capital n=${capitalHits.length} --`);
for (const h of capitalHits) {
  console.log(
    `${h.fname}=${h.val} date=${h.row.date} by=${h.row.contributed_by} desc=${h.row.description}`,
  );
}
console.log(`\n-- fixed_assets n=${faHits.length} --`);
for (const h of faHits) {
  console.log(
    `${h.fname}=${h.val} purchase=${h.row.purchase_date} name=${h.row.asset_name} cost=${h.row.original_cost} qty=${h.row.quantity}`,
  );
}
console.log(`\n-- AP n=${apHits.length} --`);
for (const h of apHits) {
  console.log(
    `${h.fname}=${h.val} inv_date=${h.row.invoice_date} vendor=${h.row.vendor_name} inv=${h.row.invoice_number}`,
  );
}
console.log(`\n-- tax_ledger n=${taxHits.length} --`);
for (const h of taxHits) {
  console.log(
    `${h.fname}=${h.val} date=${h.row.entry_date} ${h.row.direction}/${h.row.tax_component} status=${h.row.status} src=${h.row.source_type}:${h.row.source_id}`,
  );
}

const inJuly = (d: unknown) => {
  const s = String(d ?? "").slice(0, 10);
  return s >= "2026-07-01" && s <= "2026-07-31";
};
const inJune = (d: unknown) => {
  const s = String(d ?? "").slice(0, 10);
  return s >= "2026-06-01" && s <= "2026-06-30";
};

console.log("\n=== 5. JULY-DATED ACTIVITY ===");
console.log(
  "July income count/sum amount:",
  data.incomeEntries.filter((r) => inJuly(r.date)).length,
  r2(
    data.incomeEntries
      .filter((r) => inJuly(r.date))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0),
  ),
);
console.log("July income rows:");
for (const r of data.incomeEntries.filter((r) => inJuly(r.date))) {
  console.log(
    `  ${r.date} ${r.invoice_no} amt=${r.amount} recv=${r.amount_received} out=${r.outstanding_balance} vat=${r.output_vat_amount} net=${r.net_of_tax_amount} status=${r.payment_status} cat=${r.service_category}`,
  );
}
console.log("July expenses:");
for (const r of data.expenseEntries.filter((r) => inJuly(r.date))) {
  console.log(
    `  ${r.date} ${r.receipt_no} amt=${r.amount} net=${r.net_of_tax_amount} vat=${r.input_vat_amount} cat=${r.expense_category}/${r.sub_category} status=${r.payment_status} desc=${String(r.description ?? "").slice(0, 50)}`,
  );
}
console.log(
  "July capital:",
  data.capitalContributions.filter((r) => inJuly(r.date)),
);
console.log(
  "July FA purchases:",
  data.fixedAssets.filter((r) => inJuly(r.purchase_date)),
);
console.log(
  "July AP:",
  data.payableEntries.filter((r) => inJuly(r.invoice_date)),
);
console.log("July tax ledger:");
for (const r of data.taxLedgerEntries.filter(
  (r) => inJuly(r.entry_date) || String(r.period_month).startsWith("2026-07"),
)) {
  console.log(
    `  ${r.entry_date} period=${r.period_month} ${r.direction}/${r.tax_component} amt=${r.tax_amount} status=${r.status} src=${r.source_type}:${r.source_id}`,
  );
}

console.log("\nmanual_financial_entries all:");
console.log(JSON.stringify(data.manualEntries, null, 2));

const { data: loans, error: loanErr } = await admin
  .from("loan_register")
  .select("*")
  .eq("tenant_id", TENANT);
console.log("\nloan_register:", loanErr?.message ?? `n=${loans?.length}`);
console.log(JSON.stringify(loans, null, 2));

// Pairs summing to ~86.09 among July amounts
console.log("\n=== CANDIDATE PAIRS summing ~86.09 ===");
const pool = [
  ...data.incomeEntries
    .filter((r) => inJuly(r.date) || inJune(r.date))
    .flatMap((r) => [
      {
        t: "income-out",
        id: r.invoice_no,
        v: r2(r.outstanding_balance ?? 0),
        date: r.date,
      },
      { t: "income-amt", id: r.invoice_no, v: r2(r.amount), date: r.date },
      {
        t: "income-recv",
        id: r.invoice_no,
        v: r2(r.amount_received ?? 0),
        date: r.date,
      },
      {
        t: "income-vat",
        id: r.invoice_no,
        v: r2(r.output_vat_amount ?? 0),
        date: r.date,
      },
      {
        t: "income-wht",
        id: r.invoice_no,
        v: r2(r.wht_amount ?? 0),
        date: r.date,
      },
    ]),
  ...data.expenseEntries
    .filter((r) => inJuly(r.date) || inJune(r.date))
    .flatMap((r) => [
      {
        t: "exp-amt",
        id: r.receipt_no || r.id,
        v: r2(r.amount),
        date: r.date,
      },
      {
        t: "exp-vat",
        id: r.receipt_no || r.id,
        v: r2(r.input_vat_amount ?? 0),
        date: r.date,
      },
    ]),
  ...data.taxLedgerEntries
    .filter(
      (r) =>
        inJuly(r.entry_date) ||
        inJune(r.entry_date) ||
        String(r.period_month).startsWith("2026-07") ||
        String(r.period_month).startsWith("2026-06"),
    )
    .map((r) => ({
      t: "tax",
      id: `${r.tax_component}/${r.status}`,
      v: r2(r.tax_amount),
      date: r.entry_date,
    })),
].filter((x) => x.v > 0.005 && x.v < 300);

const seen = new Set<string>();
for (let i = 0; i < pool.length; i++) {
  for (let j = i + 1; j < pool.length; j++) {
    const s = r2(pool[i].v + pool[j].v);
    if (Math.abs(s - 86.09) <= 0.03) {
      const key = [pool[i].t, pool[i].id, pool[j].t, pool[j].id]
        .sort()
        .join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      console.log("pair", pool[i], "+", pool[j], "=", s);
    }
  }
}

// Single amounts within 0.5 of gap
console.log("\n=== Singles within 1.0 of 86.09 ===");
for (const x of pool) {
  if (Math.abs(x.v - 86.09) <= 1.0) {
    console.log(x);
  }
}

const { data: dedsav } = await admin
  .from("income_register")
  .select(
    "id, invoice_no, amount, outstanding_balance, amount_received, service_category, net_of_tax_amount, output_vat_amount, payment_status, date, description",
  )
  .eq("tenant_id", TENANT)
  .ilike("invoice_no", "PAYROLL-DEDSAV%");
console.log("\nDEDSAV now:", dedsav);

const { data: forfeit } = await admin
  .from("income_register")
  .select(
    "id, invoice_no, amount, outstanding_balance, amount_received, service_category, payment_status, date, description, notes",
  )
  .eq("tenant_id", TENANT)
  .or("description.ilike.%forfeit%,notes.ilike.%forfeit%,invoice_no.ilike.%forfeit%");
console.log("\nForfeit-like income:", forfeit);

// Payroll July vs June totals for AW context
function monthRows(month: string) {
  return data.payrollHistory.filter(
    (r) => String(r.payroll_month).slice(0, 7) === month,
  );
}
for (const m of ["2026-06", "2026-07"]) {
  const rows = monthRows(m);
  const gross = r2(rows.reduce((s, r) => s + (Number(r.gross_pay) || 0), 0));
  const net = r2(rows.reduce((s, r) => s + (Number(r.net_pay) || 0), 0));
  const abs = r2(
    rows.reduce((s, r) => s + (Number(r.absence_deduction) || 0), 0),
  );
  const loan = r2(
    rows.reduce((s, r) => s + (Number(r.loan_repayment) || 0), 0),
  );
  const adv = r2(
    rows.reduce((s, r) => s + (Number(r.salary_advance) || 0), 0),
  );
  const wel = r2(
    rows.reduce((s, r) => s + (Number(r.welfare_deduction) || 0), 0),
  );
  const oth = r2(
    rows.reduce((s, r) => s + (Number(r.other_deductions) || 0), 0),
  );
  console.log(
    `\nPayroll ${m}: gross=${gross} net=${net} abs=${abs} loan=${loan} adv=${adv} wel=${wel} oth=${oth} sumDed=${r2(abs + loan + adv + wel + oth)}`,
  );
}

console.log("\nmonth_end_close:", data.monthEndCloseRecords);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
