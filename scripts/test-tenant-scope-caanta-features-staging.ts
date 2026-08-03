/**
 * Staging tenant-scope proof for Caanta (non-Davors):
 * 1) Full Lock Accrued→Paid + Cash Position
 * 2) Settled (No Cash Impact)
 * 3) Auto-posted detection / Mark-as-Paid eligibility (UI logic)
 * 4) Mark as Paid Accrued ESSNIT
 * 5) Remit-for-period SSNIT / PAYE / VAT / WHT
 *
 * Usage:
 *   npx tsx scripts/test-tenant-scope-caanta-features-staging.ts --env-file .env.staging.local
 *
 * STAGING ONLY — refuses production. Synthetic FY 2097 rows; cleans up.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  isCashOutflowExpense,
  isSettledNoCashImpactStatus,
} from "../app/dashboard/finance/accrued-wages-utils";
import { buildMonthlyCashComponents } from "../app/dashboard/finance/cash-movement-utils";
import {
  canMarkAutoPostedExpenseAsPaid,
  getRegisterRowClassName,
  isAutoPostedExpenseRegisterEntry,
  markAutoPostedExpensePaid,
} from "../app/dashboard/finance/register-auto-posted-utils";
import {
  buildRemitExpenseReceiptNo,
  remitTaxForPeriod,
  type RemitTaxKind,
} from "../app/dashboard/finance/tax-ledger-remit";
import { emptyTaxSettings } from "../app/dashboard/finance/tax-utils";
import {
  deletePayrollLockFinanceEntries,
  EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
  PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
  postPayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
  type PayrollLockFinanceSourceRow,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
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
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

const FY = 2097;
const PERIOD_KEY = "2097-03";
const PAYROLL_MONTH = "2097-03-01";
const PERIOD_END = "2097-03-31";
const MONTH_INDEX = 2;
const TEST_EMPLOYEE = "CAANTA-SCOPE-EMP";
const GROSS = 1200;
const NET_PAY = 1100;
const EMPLOYER_SSNIT = 60;
const TIER2 = 15;
const EMP_SSNIT = 55;
const PAYE = 80;
const SAL_RECEIPT = `PAYROLL-SAL-${PERIOD_KEY}`;
const ESSNIT_RECEIPT = `PAYROLL-ESSNIT-${PERIOD_KEY}`;
const SETTLED_RECEIPT = `TEST-CAANTA-SETTLED-${PERIOD_KEY}`;
const MARK_ESSNIT_RECEIPT = `PAYROLL-ESSNIT-2097-04`;
const MARK_PERIOD_KEY = "2097-04";
const MARK_PAYROLL_MONTH = "2097-04-01";
const MARK_END = "2097-04-30";
const MARK_EMPLOYER = 42;
const MARK_TIER2 = 18;
const MARK_ESSNIT_AMOUNT = MARK_EMPLOYER + MARK_TIER2;

const REMIT_AMOUNTS = {
  ssnit_employee: 70,
  ssnit_employer_tier1: 45,
  ssnit_tier2: 20,
  paye: 110,
  vat_output: 90,
  vat_input: 30,
  wht_payable: 25,
};

type Result = { name: string; ok: boolean; detail: string };

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

function buildRows(): PayrollLockFinanceSourceRow[] {
  return [
    {
      employee_id: TEST_EMPLOYEE,
      gross_pay: GROSS,
      net_only_adjustment: 0,
      absence_deduction: 0,
      loan_repayment: 0,
      salary_advance: 0,
      welfare_deduction: 0,
      other_deductions: 0,
      employee_ssnit: EMP_SSNIT,
      employer_ssnit: EMPLOYER_SSNIT,
      tier2: TIER2,
      paye_tax: PAYE,
    },
  ];
}

async function cashOutflow(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  monthIndex: number,
) {
  const { data: expenseEntries, error } = await admin
    .from("expense_register")
    .select(
      "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
    )
    .eq("tenant_id", tenantId);
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

async function insertLeg(admin, row: Record<string, unknown>) {
  const { data, error } = await admin
    .from("tax_ledger_entries")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function cleanup(admin: ReturnType<typeof createClient>) {
  const period = resolvePayrollLockFinancePeriod(PAYROLL_MONTH, FY, 3);
  if (period) {
    await deletePayrollLockFinanceEntries(admin, period, CAANTA, {
      loanRepaymentRows: [{ employee_id: TEST_EMPLOYEE, loan_repayment: 0 }],
    });
  }

  const remitReceipts = (["ssnit", "paye", "vat", "wht"] as RemitTaxKind[]).map(
    (kind) => buildRemitExpenseReceiptNo(kind, "2097-05-01"),
  );
  const expenseReceipts = [
    SETTLED_RECEIPT,
    MARK_ESSNIT_RECEIPT,
    SAL_RECEIPT,
    ESSNIT_RECEIPT,
    `PAYROLL-ESSNIT-2097-05`,
    ...remitReceipts,
  ];

  await admin
    .from("expense_register")
    .delete()
    .eq("tenant_id", CAANTA)
    .in("receipt_no", expenseReceipts);

  await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("tenant_id", CAANTA)
    .like("notes", "CAANTA-SCOPE-%");

  await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("notes", "CAANTA-SCOPE-DECOY-DAVORS");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = projectRefFromUrl(url);
  if (!url || !key) {
    throw new Error("Missing staging URL or service role key");
  }
  if (!ref || PRODUCTION_PROJECT_REFS.has(ref)) {
    throw new Error(`Refusing non-staging project ref: ${ref}`);
  }
  if (ref !== STAGING_PROJECT_REF) {
    console.warn(`[caanta-scope] Unexpected ref ${ref}`);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", CAANTA)
    .maybeSingle();
  if (tenantErr) throw new Error(tenantErr.message);
  if (!tenant) throw new Error("Caanta tenant not found on staging");

  console.log(
    `[caanta-scope] tenant=${tenant.name} (${CAANTA}) project=${ref}`,
  );

  const results: Result[] = [];
  console.log("[caanta-scope] cleanup prior…");
  await cleanup(admin);

  // --- 3) Auto-posted UI logic (tenant-agnostic helpers) ---
  const autoClass = getRegisterRowClassName(0, true);
  const normalClass = getRegisterRowClassName(0, false);
  results.push({
    name: "3 Auto-posted row class distinct (all tenants)",
    ok:
      autoClass.includes("text-[#0b4f6c]") &&
      !normalClass.includes("text-[#0b4f6c]"),
    detail: `auto=${autoClass} normal=${normalClass}`,
  });
  results.push({
    name: "3 Auto-posted detection + Edit-disable eligibility",
    ok:
      isAutoPostedExpenseRegisterEntry({
        receipt_no: ESSNIT_RECEIPT,
        description: "Auto-posted from Payroll March 2097",
      }) &&
      canMarkAutoPostedExpenseAsPaid({
        receipt_no: ESSNIT_RECEIPT,
        description: "Auto-posted from Payroll March 2097",
        payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
      }) &&
      !canMarkAutoPostedExpenseAsPaid({
        receipt_no: SAL_RECEIPT,
        description: "Auto-posted from Payroll March 2097",
        payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
      }),
    detail: "Accrued ESSNIT eligible; Paid SAL not",
  });

  // --- 1) Full Lock promote Accrued → Paid ---
  const period = resolvePayrollLockFinancePeriod(PAYROLL_MONTH, FY, 3);
  if (!period) throw new Error("period resolve failed");
  const rows = buildRows();

  console.log("[caanta-scope] Partial Lock post (Accrued)…");
  await postPayrollLockFinanceEntries(admin, period, rows, CAANTA, {
    markStaffSalariesPaid: false,
  });
  const { data: salAccrued } = await admin
    .from("expense_register")
    .select("payment_status, amount, tenant_id")
    .eq("tenant_id", CAANTA)
    .eq("receipt_no", SAL_RECEIPT)
    .maybeSingle();
  results.push({
    name: "1 Partial Lock SAL Accrued on Caanta",
    ok:
      salAccrued?.tenant_id === CAANTA &&
      salAccrued?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED &&
      r2(Number(salAccrued?.amount)) === GROSS,
    detail: JSON.stringify(salAccrued),
  });

  const cashBeforeFull = await cashOutflow(admin, CAANTA, MONTH_INDEX);
  console.log("[caanta-scope] Full Lock promote (Paid)…");
  await postPayrollLockFinanceEntries(admin, period, rows, CAANTA, {
    markStaffSalariesPaid: true,
    skipLoanRepayments: true,
  });
  const { data: salPaid } = await admin
    .from("expense_register")
    .select("payment_status, amount")
    .eq("tenant_id", CAANTA)
    .eq("receipt_no", SAL_RECEIPT)
    .maybeSingle();
  const { data: essnitStillAccrued } = await admin
    .from("expense_register")
    .select("payment_status")
    .eq("tenant_id", CAANTA)
    .eq("receipt_no", ESSNIT_RECEIPT)
    .maybeSingle();
  const cashAfterFull = await cashOutflow(admin, CAANTA, MONTH_INDEX);
  results.push({
    name: "1 Full Lock SAL Paid + Cash Position on Caanta",
    ok:
      salPaid?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_PAID &&
      essnitStillAccrued?.payment_status ===
        PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED &&
      r2(cashAfterFull - cashBeforeFull) === GROSS,
    detail: `sal=${salPaid?.payment_status} essnit=${essnitStillAccrued?.payment_status} cashDelta=${r2(cashAfterFull - cashBeforeFull)}`,
  });

  // Davors must not pick up Caanta SAL receipt
  const { data: davorsSal } = await admin
    .from("expense_register")
    .select("id")
    .eq("tenant_id", DAVORS)
    .eq("receipt_no", SAL_RECEIPT)
    .maybeSingle();
  results.push({
    name: "1 Davors has no Caanta Full Lock SAL receipt",
    ok: !davorsSal,
    detail: JSON.stringify(davorsSal),
  });

  // --- 2) Settled (No Cash Impact) ---
  const cashBeforeSettled = await cashOutflow(admin, CAANTA, MONTH_INDEX);
  const { error: settledErr } = await admin.from("expense_register").insert({
    tenant_id: CAANTA,
    date: PERIOD_END,
    expense_category: "Transportation",
    sub_category: "Fuel",
    description: "Caanta Settled AP pairing",
    vendor: "Caanta Vendor",
    price: 500,
    quantity: 1,
    amount: 500,
    payment_method: "Accrual",
    approved_by: "System",
    receipt_no: SETTLED_RECEIPT,
    payment_status: EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
    notes: "CAANTA-SCOPE-SETTLED",
  });
  if (settledErr) throw new Error(settledErr.message);
  const cashAfterSettled = await cashOutflow(admin, CAANTA, MONTH_INDEX);
  results.push({
    name: "2 Settled status recognized + no cash outflow (Caanta)",
    ok:
      isSettledNoCashImpactStatus(EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH) &&
      !isCashOutflowExpense({
        payment_status: EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
        amount: 500,
        receipt_no: SETTLED_RECEIPT,
      }) &&
      cashAfterSettled === cashBeforeSettled,
    detail: `before=${cashBeforeSettled} after=${cashAfterSettled}`,
  });

  // --- 4) Mark as Paid Accrued ESSNIT ---
  const markSourceId = buildPayrollPeriodTaxLedgerSourceId(MARK_PAYROLL_MONTH);
  const { data: markEssnit, error: markEssnitErr } = await admin
    .from("expense_register")
    .insert({
      tenant_id: CAANTA,
      date: MARK_END,
      expense_category: "Employer SSNIT Contribution",
      sub_category: "Payroll",
      description: "Auto-posted from Payroll April 2097",
      vendor: "SSNIT",
      price: MARK_ESSNIT_AMOUNT,
      quantity: 1,
      amount: MARK_ESSNIT_AMOUNT,
      payment_method: "Accrual",
      approved_by: "System",
      receipt_no: MARK_ESSNIT_RECEIPT,
      payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
      notes: "CAANTA-SCOPE-MARK-PAID",
    })
    .select("id, tenant_id, receipt_no, payment_status, description")
    .single();
  if (markEssnitErr) throw new Error(markEssnitErr.message);

  for (const [component, amount] of [
    ["ssnit_employer_tier1", MARK_EMPLOYER],
    ["ssnit_tier2", MARK_TIER2],
    ["ssnit_employee", 33],
  ] as const) {
    await insertLeg(admin, {
      tenant_id: CAANTA,
      entry_date: MARK_END,
      period_month: MARK_PAYROLL_MONTH,
      direction: "statutory_payable",
      tax_component: component,
      taxable_base: 0,
      tax_amount: amount,
      status: "open",
      source_type: PAYROLL_PERIOD_SOURCE_TYPE,
      source_id: markSourceId,
      counterparty_name: "SSNIT",
      notes: `CAANTA-SCOPE-MARK-${component}`,
    });
  }

  const cashBeforeMark = await cashOutflow(admin, CAANTA, 3);
  const markResult = await markAutoPostedExpensePaid(admin, markEssnit);
  const { data: markAfter } = await admin
    .from("expense_register")
    .select("payment_status")
    .eq("id", markEssnit.id)
    .maybeSingle();
  const { data: markTax } = await admin
    .from("tax_ledger_entries")
    .select("tax_component, status")
    .eq("tenant_id", CAANTA)
    .eq("source_id", markSourceId);
  const markByComp = new Map(
    (markTax ?? []).map((row) => [row.tax_component, row.status]),
  );
  const cashAfterMark = await cashOutflow(admin, CAANTA, 3);
  results.push({
    name: "4 Mark as Paid ESSNIT on Caanta + employer tax remitted",
    ok:
      !markResult.error &&
      markResult.taxLegsRemitted === 2 &&
      markAfter?.payment_status === "Paid" &&
      markByComp.get("ssnit_employer_tier1") === "paid" &&
      markByComp.get("ssnit_tier2") === "paid" &&
      markByComp.get("ssnit_employee") === "open" &&
      r2(cashAfterMark - cashBeforeMark) === MARK_ESSNIT_AMOUNT,
    detail: JSON.stringify({
      markResult,
      status: markAfter?.payment_status,
      tax: Object.fromEntries(markByComp),
      cashDelta: r2(cashAfterMark - cashBeforeMark),
    }),
  });

  // --- 5) Remit-for-period (all four) on Caanta ---
  const remitMonth = "2097-05-01";
  const remitEnd = "2097-05-31";
  const remitSourceId = buildPayrollPeriodTaxLedgerSourceId(remitMonth);
  const stamp = "CAANTA-SCOPE-REMIT";
  const taxIds: string[] = [];

  for (const [component, amount] of [
    ["ssnit_employee", REMIT_AMOUNTS.ssnit_employee],
    ["ssnit_employer_tier1", REMIT_AMOUNTS.ssnit_employer_tier1],
    ["ssnit_tier2", REMIT_AMOUNTS.ssnit_tier2],
  ] as const) {
    taxIds.push(
      await insertLeg(admin, {
        tenant_id: CAANTA,
        entry_date: remitEnd,
        period_month: remitMonth,
        direction: "statutory_payable",
        tax_component: component,
        taxable_base: amount * 10,
        tax_amount: amount,
        status: "open",
        source_type: PAYROLL_PERIOD_SOURCE_TYPE,
        source_id: remitSourceId,
        counterparty_name: "SSNIT",
        notes: stamp,
      }),
    );
  }

  // Accrued ESSNIT for SSNIT remit Settled alignment
  const remitEssnitReceipt = `PAYROLL-ESSNIT-2097-05`;
  await admin.from("expense_register").insert({
    tenant_id: CAANTA,
    date: remitEnd,
    expense_category: "Employer SSNIT Contribution",
    sub_category: "Payroll",
    description: "Auto-posted from Payroll May 2097",
    vendor: "SSNIT",
    price: REMIT_AMOUNTS.ssnit_employer_tier1 + REMIT_AMOUNTS.ssnit_tier2,
    quantity: 1,
    amount: REMIT_AMOUNTS.ssnit_employer_tier1 + REMIT_AMOUNTS.ssnit_tier2,
    payment_method: "Accrual",
    approved_by: "System",
    receipt_no: remitEssnitReceipt,
    payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
    notes: stamp,
  });

  taxIds.push(
    await insertLeg(admin, {
      tenant_id: CAANTA,
      entry_date: remitEnd,
      period_month: remitMonth,
      direction: "statutory_payable",
      tax_component: "paye",
      taxable_base: REMIT_AMOUNTS.paye * 5,
      tax_amount: REMIT_AMOUNTS.paye,
      status: "open",
      source_type: PAYROLL_PERIOD_SOURCE_TYPE,
      source_id: remitSourceId,
      counterparty_name: "GRA",
      notes: stamp,
    }),
  );
  taxIds.push(
    await insertLeg(admin, {
      tenant_id: CAANTA,
      entry_date: remitEnd,
      period_month: remitMonth,
      direction: "output",
      tax_component: "vat_bundle",
      rate_pct: 15,
      taxable_base: 600,
      tax_amount: REMIT_AMOUNTS.vat_output,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "GRA",
      notes: stamp,
    }),
  );
  taxIds.push(
    await insertLeg(admin, {
      tenant_id: CAANTA,
      entry_date: remitEnd,
      period_month: remitMonth,
      direction: "input",
      tax_component: "vat_bundle",
      rate_pct: 15,
      taxable_base: 200,
      tax_amount: REMIT_AMOUNTS.vat_input,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "Supplier",
      notes: stamp,
    }),
  );
  taxIds.push(
    await insertLeg(admin, {
      tenant_id: CAANTA,
      entry_date: remitEnd,
      period_month: remitMonth,
      direction: "wht_payable",
      tax_component: "wht",
      rate_pct: 5,
      taxable_base: 500,
      tax_amount: REMIT_AMOUNTS.wht_payable,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "GRA",
      notes: stamp,
    }),
  );

  // Davors decoy — must stay open when remitting as Caanta
  taxIds.push(
    await insertLeg(admin, {
      tenant_id: DAVORS,
      entry_date: remitEnd,
      period_month: remitMonth,
      direction: "statutory_payable",
      tax_component: "paye",
      taxable_base: 999,
      tax_amount: 99,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "ISO",
      notes: "CAANTA-SCOPE-DECOY-DAVORS",
    }),
  );

  const settings = emptyTaxSettings(CAANTA);
  const expectedSsnit =
    REMIT_AMOUNTS.ssnit_employee +
    REMIT_AMOUNTS.ssnit_employer_tier1 +
    REMIT_AMOUNTS.ssnit_tier2;
  const expectedVat = r2(REMIT_AMOUNTS.vat_output - REMIT_AMOUNTS.vat_input);
  const kinds: Array<{ kind: RemitTaxKind; cash: number; legs: number }> = [
    { kind: "ssnit", cash: expectedSsnit, legs: 3 },
    { kind: "paye", cash: REMIT_AMOUNTS.paye, legs: 1 },
    { kind: "vat", cash: expectedVat, legs: 2 },
    { kind: "wht", cash: REMIT_AMOUNTS.wht_payable, legs: 1 },
  ];

  for (const { kind, cash, legs } of kinds) {
    const result = await remitTaxForPeriod(admin, {
      tenantId: CAANTA,
      periodMonth: remitMonth,
      kind,
      settings,
    });
    results.push({
      name: `5 Remit ${kind.toUpperCase()} for period on Caanta`,
      ok:
        !result.error &&
        result.legsCleared === legs &&
        r2(result.cashAmount) === r2(cash) &&
        (kind !== "ssnit" ||
          result.essnitAligned === "settled" ||
          result.essnitAligned === "already_settled"),
      detail: JSON.stringify({
        error: result.error,
        legs: result.legsCleared,
        cash: result.cashAmount,
        essnit: result.essnitAligned,
        msg: result.message,
      }),
    });
  }

  const { data: remitEssnitAfter } = await admin
    .from("expense_register")
    .select("payment_status")
    .eq("tenant_id", CAANTA)
    .eq("receipt_no", remitEssnitReceipt)
    .maybeSingle();
  results.push({
    name: "5 SSNIT remit settles Caanta ESSNIT (No Cash Impact)",
    ok: isSettledNoCashImpactStatus(remitEssnitAfter?.payment_status),
    detail: String(remitEssnitAfter?.payment_status),
  });

  const { data: davorsDecoy } = await admin
    .from("tax_ledger_entries")
    .select("status, tax_amount")
    .eq("tenant_id", DAVORS)
    .eq("notes", "CAANTA-SCOPE-DECOY-DAVORS")
    .maybeSingle();
  results.push({
    name: "5 Davors decoy PAYE untouched by Caanta remit",
    ok:
      davorsDecoy?.status === "open" &&
      r2(Number(davorsDecoy?.tax_amount)) === 99,
    detail: JSON.stringify(davorsDecoy),
  });

  console.log("\n=== Caanta tenant-scope results ===");
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failed += 1;
    console.log(`${mark} | ${r.name} | ${r.detail}`);
  }

  console.log("[caanta-scope] cleanup…");
  await cleanup(admin);
  // Also remove remit ESSNIT receipt used in section 5
  await admin
    .from("expense_register")
    .delete()
    .eq("tenant_id", CAANTA)
    .eq("receipt_no", remitEssnitReceipt);
  if (taxIds.length > 0) {
    await admin.from("tax_ledger_entries").delete().in("id", taxIds);
  }

  console.log(
    `\n[caanta-scope] ${results.length - failed}/${results.length} passed`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
