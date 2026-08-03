/**
 * Staging verification: Settled (No Cash Impact) + auto-posted Mark as Paid (ESSNIT).
 *
 * Usage:
 *   npx tsx scripts/test-settled-and-mark-paid-staging.ts
 *   npx tsx scripts/test-settled-and-mark-paid-staging.ts --env-file .env.staging.local
 *
 * STAGING ONLY — refuses production project refs. Cleans up its own rows.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  isAccruedStaffSalariesExpense,
  isCashOutflowExpense,
  isSettledNoCashImpactStatus,
} from "../app/dashboard/finance/accrued-wages-utils";
import { buildMonthlyCashComponents } from "../app/dashboard/finance/cash-movement-utils";
import {
  canMarkAutoPostedExpenseAsPaid,
  isAutoPostedExpenseRegisterEntry,
  isAutoPostedIncomeRegisterEntry,
  markAutoPostedExpensePaid,
} from "../app/dashboard/finance/register-auto-posted-utils";
import { EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH } from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  buildPayrollPeriodTaxLedgerSourceId,
  PAYROLL_PERIOD_SOURCE_TYPE,
} from "../app/dashboard/hr-payroll/payroll-statutory-ledger-sync";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function resolveEnvFile(argv: string[]) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return ".env.staging.local";
}

loadEnvForce(resolve(resolveEnvFile(process.argv.slice(2))));

const PRODUCTION_PROJECT_REFS = new Set(["tvcurcnmasnocwdxzgvz"]);
const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2098;
const PERIOD_KEY = "2098-11";
const PAYROLL_MONTH = "2098-11-01";
const EXPENSE_DATE = "2098-11-30";
const SETTLED_RECEIPT = `TEST-SETTLED-${PERIOD_KEY}`;
const ESSNIT_RECEIPT = `PAYROLL-ESSNIT-${PERIOD_KEY}`;
const SAL_RECEIPT = `PAYROLL-SAL-${PERIOD_KEY}`;
const DEDSAV_INVOICE = `PAYROLL-DEDSAV-${PERIOD_KEY}`;
const EMPLOYER_TIER1 = 40;
const TIER2 = 15;
const ESSNIT_AMOUNT = EMPLOYER_TIER1 + TIER2;
const SETTLED_AMOUNT = 1810;

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

type Result = { name: string; ok: boolean; detail: string };

async function cashOutflowForMonth(
  admin: ReturnType<typeof createClient>,
  monthIndex: number,
) {
  const { data: expenseEntries, error } = await admin
    .from("expense_register")
    .select(
      "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
    )
    .eq("tenant_id", DAVORS);
  if (error) throw new Error(error.message);

  const components = buildMonthlyCashComponents(
    {
      incomeEntries: [],
      expenseEntries: expenseEntries ?? [],
      capitalContributions: [],
      fixedAssets: [],
      rawMaterialCashPurchases: [],
      productCashPurchases: [],
      inventoryConfig: null,
      manualEntries: [],
      accountsPayableSettlements: [],
      staffSalaryNetByPayrollMonth: new Map(),
    },
    FY,
  );
  return r2(components.paidExpenses[monthIndex] ?? 0);
}

async function cleanup(admin: ReturnType<typeof createClient>) {
  const sourceId = buildPayrollPeriodTaxLedgerSourceId(PAYROLL_MONTH);
  await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("source_type", PAYROLL_PERIOD_SOURCE_TYPE)
    .eq("source_id", sourceId);
  await admin
    .from("expense_register")
    .delete()
    .eq("tenant_id", DAVORS)
    .in("receipt_no", [SETTLED_RECEIPT, ESSNIT_RECEIPT, SAL_RECEIPT]);
  await admin
    .from("income_register")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("invoice_no", DEDSAV_INVOICE);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE;
  const ref = projectRefFromUrl(url);
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or service role key");
  }
  if (!ref || PRODUCTION_PROJECT_REFS.has(ref)) {
    throw new Error(`Refusing non-staging project ref: ${ref}`);
  }
  if (ref !== STAGING_PROJECT_REF) {
    console.warn(`Unexpected staging ref ${ref} (expected ${STAGING_PROJECT_REF})`);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: Result[] = [];
  console.log("[settled-mark-paid] cleanup prior…");
  await cleanup(admin);

  const cashBefore = await cashOutflowForMonth(admin, 10); // November = index 10

  // --- Unit checks (no DB) ---
  results.push({
    name: "isSettledNoCashImpactStatus recognizes label",
    ok: isSettledNoCashImpactStatus(EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH),
    detail: EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
  });
  results.push({
    name: "Settled expense is NOT cash outflow",
    ok: !isCashOutflowExpense({
      date: EXPENSE_DATE,
      expense_category: "Transportation",
      sub_category: "Fuel",
      amount: SETTLED_AMOUNT,
      payment_status: EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
      description: "Ernest AP pairing",
      receipt_no: SETTLED_RECEIPT,
    }),
    detail: "isCashOutflowExpense=false",
  });
  results.push({
    name: "Settled Staff Salaries is NOT Accrued wages",
    ok: !isAccruedStaffSalariesExpense({
      date: EXPENSE_DATE,
      expense_category: "Staff Salaries",
      sub_category: "Payroll",
      amount: 100,
      payment_status: EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
      description: "Auto-posted from Payroll November 2098",
      receipt_no: SAL_RECEIPT,
    }),
    detail: "Settled clears orphan pairing without Accrued Wages",
  });
  results.push({
    name: "DEDSAV never gets Mark as Paid (income)",
    ok:
      isAutoPostedIncomeRegisterEntry({
        invoice_no: DEDSAV_INVOICE,
        description: "Auto-posted from Payroll November 2098 - Deduction Savings",
        is_system_adjustment: true,
      }) &&
      !canMarkAutoPostedExpenseAsPaid({
        receipt_no: DEDSAV_INVOICE,
        description: "Auto-posted from Payroll November 2098",
        payment_status: "Accrued - Not Yet Paid",
      }),
    detail: "income auto-posted; expense Mark as Paid false for DEDSAV receipt",
  });
  results.push({
    name: "Paid SAL never gets Mark as Paid",
    ok: !canMarkAutoPostedExpenseAsPaid({
      receipt_no: SAL_RECEIPT,
      description: "Auto-posted from Payroll November 2098",
      payment_status: "Paid",
    }),
    detail: "Full Lock Paid → no Mark as Paid",
  });
  results.push({
    name: "Accrued ESSNIT eligible for Mark as Paid",
    ok: canMarkAutoPostedExpenseAsPaid({
      receipt_no: ESSNIT_RECEIPT,
      description: "Auto-posted from Payroll November 2098",
      payment_status: "Accrued - Not Yet Paid",
    }),
    detail: "Accrued ESSNIT → Mark as Paid",
  });

  // --- Insert Settled expense (AP-style pairing) ---
  console.log("[settled-mark-paid] insert Settled expense…");
  const { data: settledRow, error: settledErr } = await admin
    .from("expense_register")
    .insert({
      tenant_id: DAVORS,
      date: EXPENSE_DATE,
      expense_category: "Transportation",
      sub_category: "Fuel",
      description: "Staging Settled AP pairing (Ernest-style)",
      vendor: "Ernest Lartey (Driver)",
      price: SETTLED_AMOUNT,
      quantity: 1,
      amount: SETTLED_AMOUNT,
      payment_method: "Accrual",
      approved_by: "System",
      receipt_no: SETTLED_RECEIPT,
      payment_status: EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
      notes: "STAGING TEST — Settled (No Cash Impact)",
    })
    .select("id, payment_status, amount")
    .single();
  if (settledErr) throw new Error(settledErr.message);

  const cashAfterSettled = await cashOutflowForMonth(admin, 10);
  results.push({
    name: "Settled expense does not change Cash Position outflow",
    ok: cashAfterSettled === cashBefore,
    detail: `before=${cashBefore} afterSettled=${cashAfterSettled} id=${settledRow.id}`,
  });

  // --- Insert Accrued ESSNIT + open employer tax legs ---
  console.log("[settled-mark-paid] insert Accrued ESSNIT + tax legs…");
  const { data: essnitRow, error: essnitErr } = await admin
    .from("expense_register")
    .insert({
      tenant_id: DAVORS,
      date: EXPENSE_DATE,
      expense_category: "Employer SSNIT Contribution",
      sub_category: "Payroll",
      description: "Auto-posted from Payroll November 2098",
      vendor: "SSNIT",
      price: ESSNIT_AMOUNT,
      quantity: 1,
      amount: ESSNIT_AMOUNT,
      payment_method: "Accrual",
      approved_by: "System",
      receipt_no: ESSNIT_RECEIPT,
      payment_status: "Accrued - Not Yet Paid",
      notes: "STAGING TEST — Mark as Paid",
    })
    .select("id, tenant_id, receipt_no, payment_status, description, amount")
    .single();
  if (essnitErr) throw new Error(essnitErr.message);

  results.push({
    name: "ESSNIT detected as auto-posted",
    ok: isAutoPostedExpenseRegisterEntry(essnitRow),
    detail: essnitRow.receipt_no,
  });

  const sourceId = buildPayrollPeriodTaxLedgerSourceId(PAYROLL_MONTH);
  const taxInserts = [
    {
      tenant_id: DAVORS,
      entry_date: EXPENSE_DATE,
      period_month: PAYROLL_MONTH,
      direction: "statutory_payable",
      tax_component: "ssnit_employer_tier1",
      taxable_base: 0,
      tax_amount: EMPLOYER_TIER1,
      status: "open",
      source_type: PAYROLL_PERIOD_SOURCE_TYPE,
      source_id: sourceId,
      counterparty_name: "SSNIT",
      notes: "STAGING TEST employer tier1",
    },
    {
      tenant_id: DAVORS,
      entry_date: EXPENSE_DATE,
      period_month: PAYROLL_MONTH,
      direction: "statutory_payable",
      tax_component: "ssnit_tier2",
      taxable_base: 0,
      tax_amount: TIER2,
      status: "open",
      source_type: PAYROLL_PERIOD_SOURCE_TYPE,
      source_id: sourceId,
      counterparty_name: "SSNIT",
      notes: "STAGING TEST tier2",
    },
    {
      tenant_id: DAVORS,
      entry_date: EXPENSE_DATE,
      period_month: PAYROLL_MONTH,
      direction: "statutory_payable",
      tax_component: "ssnit_employee",
      taxable_base: 0,
      tax_amount: 25,
      status: "open",
      source_type: PAYROLL_PERIOD_SOURCE_TYPE,
      source_id: sourceId,
      counterparty_name: "SSNIT",
      notes: "STAGING TEST employee — must stay open",
    },
  ];
  const { error: taxInsErr } = await admin
    .from("tax_ledger_entries")
    .insert(taxInserts);
  if (taxInsErr) throw new Error(taxInsErr.message);

  const cashBeforeMark = await cashOutflowForMonth(admin, 10);
  console.log("[settled-mark-paid] Mark as Paid ESSNIT…");
  const markResult = await markAutoPostedExpensePaid(admin, essnitRow);
  results.push({
    name: "Mark as Paid ESSNIT succeeds + remits employer tax legs",
    ok: !markResult.error && markResult.taxLegsRemitted === 2,
    detail: JSON.stringify(markResult),
  });

  const { data: essnitAfter } = await admin
    .from("expense_register")
    .select("payment_status")
    .eq("id", essnitRow.id)
    .maybeSingle();
  results.push({
    name: "ESSNIT payment_status is Paid",
    ok: essnitAfter?.payment_status === "Paid",
    detail: String(essnitAfter?.payment_status),
  });

  const cashAfterMark = await cashOutflowForMonth(admin, 10);
  results.push({
    name: "Mark as Paid posts Cash Position outflow for ESSNIT amount",
    ok: r2(cashAfterMark - cashBeforeMark) === r2(ESSNIT_AMOUNT),
    detail: `delta=${r2(cashAfterMark - cashBeforeMark)} expected=${ESSNIT_AMOUNT}`,
  });

  const { data: taxAfter } = await admin
    .from("tax_ledger_entries")
    .select("tax_component, status")
    .eq("tenant_id", DAVORS)
    .eq("source_id", sourceId)
    .neq("status", "reversed");
  const byComp = new Map(
    (taxAfter ?? []).map((row) => [row.tax_component, row.status]),
  );
  results.push({
    name: "Employer SSNIT tax legs remitted; employee stays open",
    ok:
      byComp.get("ssnit_employer_tier1") === "paid" &&
      byComp.get("ssnit_tier2") === "paid" &&
      byComp.get("ssnit_employee") === "open",
    detail: JSON.stringify(Object.fromEntries(byComp)),
  });

  console.log("[settled-mark-paid] cleanup…");
  await cleanup(admin);

  console.log("\n=== RESULTS ===");
  let failed = 0;
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    if (!result.ok) failed += 1;
    console.log(`${mark}: ${result.name} — ${result.detail}`);
  }
  if (failed > 0) {
    process.exitCode = 1;
    console.log(`\nFAILED ${failed}/${results.length}`);
  } else {
    console.log(`\nPASS: all ${results.length} checks`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
