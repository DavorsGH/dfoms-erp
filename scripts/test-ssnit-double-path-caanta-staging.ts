/**
 * Staging: ESSNIT Mark as Paid vs Remit SSNIT double-path + summary scoping
 * on Caanta Market (non-Davors tenant).
 *
 * Mirrors scripts/test-ssnit-double-path-staging.ts (Davors 10/10) plus
 * tenant-isolation evidence (Davors decoy stays open under Caanta remit).
 *
 * Verifies:
 *  (a) Remit first → ESSNIT Settled (No Cash Impact); Mark as Paid blocked
 *  (b) Mark as Paid first → employer legs remitted; subsequent Remit posts
 *      employee cash only (no employer double-cash / double-clear)
 *  (c) summarizeOpenTaxBalances respects periodMonth
 *  (d) Caanta remit does not clear a Davors open decoy leg
 *
 * Usage:
 *   npx tsx scripts/test-ssnit-double-path-caanta-staging.ts
 *   npx tsx scripts/test-ssnit-double-path-caanta-staging.ts --env-file .env.staging.local
 *
 * STAGING ONLY — refuses production project refs. Cleans up its own rows.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  isSettledNoCashImpactStatus,
} from "../app/dashboard/finance/accrued-wages-utils";
import { buildMonthlyCashComponents } from "../app/dashboard/finance/cash-movement-utils";
import {
  canMarkAutoPostedExpenseAsPaid,
  markAutoPostedExpensePaid,
} from "../app/dashboard/finance/register-auto-posted-utils";
import {
  buildRemitExpenseReceiptNo,
  remitTaxForPeriod,
} from "../app/dashboard/finance/tax-ledger-remit";
import { summarizeOpenTaxBalances } from "../app/dashboard/finance/tax-ledger-utils";
import { emptyTaxSettings } from "../app/dashboard/finance/tax-utils";
import {
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
  PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
  buildPayrollExpenseReceiptNo,
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

/** Synthetic far-future periods — avoid Davors 2096 / Caanta-scope 2097 collisions. */
const FY = 2098;
const PATH_A = {
  key: "2098-01",
  month: "2098-01-01",
  end: "2098-01-31",
  employee: 111,
  employer: 77,
  tier2: 22,
};
const PATH_B = {
  key: "2098-02",
  month: "2098-02-01",
  end: "2098-02-28",
  employee: 130,
  employer: 90,
  tier2: 30,
};
const SUMMARY_A = {
  key: "2098-03",
  month: "2098-03-01",
  employee: 10,
  employer: 20,
  tier2: 5,
};
const SUMMARY_B = {
  key: "2098-04",
  month: "2098-04-01",
  employee: 100,
  employer: 200,
  tier2: 50,
};

const DECOY_NOTES = "CAANTA-SSNIT-DP-DECOY-DAVORS";
const STAMP_A = "CAANTA-SSNIT-DOUBLE-PATH-A";
const STAMP_B = "CAANTA-SSNIT-DOUBLE-PATH-B";

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

async function insertLeg(
  admin: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  const { data, error } = await admin
    .from("tax_ledger_entries")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function seedSsnitPeriod(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  period: {
    key: string;
    month: string;
    end: string;
    employee: number;
    employer: number;
    tier2: number;
  },
  stamp: string,
) {
  const sourceId = buildPayrollPeriodTaxLedgerSourceId(period.month);
  const essnitReceipt = buildPayrollExpenseReceiptNo("ESSNIT", period.key);
  const essnitAmount = period.employer + period.tier2;
  const ids: string[] = [];

  const { data: essnit, error: essnitErr } = await admin
    .from("expense_register")
    .insert({
      tenant_id: tenantId,
      date: period.end,
      expense_category: "Employer SSNIT Contribution",
      sub_category: "Payroll",
      description: `Auto-posted from Payroll ${period.key}`,
      vendor: "SSNIT",
      price: essnitAmount,
      quantity: 1,
      amount: essnitAmount,
      payment_method: "Accrual",
      approved_by: "System",
      receipt_no: essnitReceipt,
      payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
      notes: stamp,
    })
    .select("id, tenant_id, receipt_no, payment_status, description")
    .single();
  if (essnitErr) throw new Error(essnitErr.message);

  for (const [component, amount] of [
    ["ssnit_employee", period.employee],
    ["ssnit_employer_tier1", period.employer],
    ["ssnit_tier2", period.tier2],
  ] as const) {
    ids.push(
      await insertLeg(admin, {
        tenant_id: tenantId,
        entry_date: period.end,
        period_month: period.month,
        direction: "statutory_payable",
        tax_component: component,
        taxable_base: amount * 10,
        tax_amount: amount,
        status: "open",
        source_type: PAYROLL_PERIOD_SOURCE_TYPE,
        source_id: sourceId,
        counterparty_name: "SSNIT",
        notes: stamp,
      }),
    );
  }

  return { essnit, ids, essnitReceipt, essnitAmount, sourceId };
}

async function cleanup(
  admin: ReturnType<typeof createClient>,
  taxIds: string[],
  caantaReceiptNos: string[],
) {
  if (taxIds.length) {
    await admin.from("tax_ledger_entries").delete().in("id", taxIds);
  }
  if (caantaReceiptNos.length) {
    await admin
      .from("expense_register")
      .delete()
      .eq("tenant_id", CAANTA)
      .in("receipt_no", caantaReceiptNos);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = projectRefFromUrl(url);

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!ref || PRODUCTION_PROJECT_REFS.has(ref)) {
    throw new Error(`Refusing non-staging project ref: ${ref}`);
  }
  if (ref !== STAGING_PROJECT_REF) {
    console.warn(`Warning: expected staging ref ${STAGING_PROJECT_REF}, got ${ref}`);
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
  if (!tenant) throw new Error(`Caanta tenant not found: ${CAANTA}`);

  console.log(
    `[caanta-ssnit-dp] tenant=${tenant.name} (${CAANTA}) project=${ref}`,
  );

  const results: Result[] = [];
  const taxIds: string[] = [];
  const receiptNos: string[] = [];

  const { data: settingsBefore } = await admin
    .from("tax_settings")
    .select(
      "next_ssnit_due_date, next_tier2_due_date, next_paye_due_date, next_vat_due_date, next_wht_due_date, updated_at",
    )
    .eq("tenant_id", CAANTA)
    .maybeSingle();

  // Null due-days → remittance due-date advance is a no-op (avoids mutating staging).
  const settings = {
    ...emptyTaxSettings(CAANTA),
    ssnit_return_due_day: null,
    tier2_return_due_day: null,
    paye_return_due_day: null,
  };

  try {
    // --- Summary card period scoping (pure) ---
    const summaryEntries = [
      {
        status: "open" as const,
        period_month: SUMMARY_A.month,
        direction: "statutory_payable" as const,
        tax_component: "ssnit_employee" as const,
        tax_amount: SUMMARY_A.employee,
      },
      {
        status: "open" as const,
        period_month: SUMMARY_A.month,
        direction: "statutory_payable" as const,
        tax_component: "ssnit_employer_tier1" as const,
        tax_amount: SUMMARY_A.employer,
      },
      {
        status: "open" as const,
        period_month: SUMMARY_A.month,
        direction: "statutory_payable" as const,
        tax_component: "ssnit_tier2" as const,
        tax_amount: SUMMARY_A.tier2,
      },
      {
        status: "open" as const,
        period_month: SUMMARY_B.month,
        direction: "statutory_payable" as const,
        tax_component: "ssnit_employee" as const,
        tax_amount: SUMMARY_B.employee,
      },
      {
        status: "open" as const,
        period_month: SUMMARY_B.month,
        direction: "statutory_payable" as const,
        tax_component: "ssnit_employer_tier1" as const,
        tax_amount: SUMMARY_B.employer,
      },
      {
        status: "open" as const,
        period_month: SUMMARY_B.month,
        direction: "statutory_payable" as const,
        tax_component: "ssnit_tier2" as const,
        tax_amount: SUMMARY_B.tier2,
      },
    ];
    const allOpen = summarizeOpenTaxBalances(summaryEntries);
    const monthA = summarizeOpenTaxBalances(summaryEntries, SUMMARY_A.month);
    results.push({
      name: "Summary cards: all-open totals ignore period",
      ok:
        allOpen.ssnitEmployee === SUMMARY_A.employee + SUMMARY_B.employee &&
        allOpen.ssnitEmployerTier1 === SUMMARY_A.employer + SUMMARY_B.employer &&
        allOpen.ssnitTier2 === SUMMARY_A.tier2 + SUMMARY_B.tier2,
      detail: JSON.stringify(allOpen),
    });
    results.push({
      name: "Summary cards: periodMonth scopes to selected month",
      ok:
        monthA.ssnitEmployee === SUMMARY_A.employee &&
        monthA.ssnitEmployerTier1 === SUMMARY_A.employer &&
        monthA.ssnitTier2 === SUMMARY_A.tier2,
      detail: JSON.stringify(monthA),
    });

    // Davors decoy — must stay open when remitting as Caanta (same period as Path A).
    const decoyId = await insertLeg(admin, {
      tenant_id: DAVORS,
      entry_date: PATH_A.end,
      period_month: PATH_A.month,
      direction: "statutory_payable",
      tax_component: "ssnit_employee",
      taxable_base: 9990,
      tax_amount: 99,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "ISO-DECOY",
      notes: DECOY_NOTES,
    });
    taxIds.push(decoyId);

    // --- (a) Remit first ---
    const seedA = await seedSsnitPeriod(admin, CAANTA, PATH_A, STAMP_A);
    taxIds.push(...seedA.ids);
    receiptNos.push(seedA.essnitReceipt);
    const remitReceiptA = buildRemitExpenseReceiptNo("ssnit", PATH_A.month);
    receiptNos.push(remitReceiptA);

    const cashBeforeA = await cashOutflowForMonth(admin, CAANTA, 0); // Jan
    const remitA = await remitTaxForPeriod(admin, {
      tenantId: CAANTA,
      periodMonth: PATH_A.month,
      kind: "ssnit",
      settings,
    });
    const { data: essnitAfterA } = await admin
      .from("expense_register")
      .select("id, receipt_no, payment_status, description")
      .eq("tenant_id", CAANTA)
      .eq("receipt_no", seedA.essnitReceipt)
      .maybeSingle();
    const cashAfterA = await cashOutflowForMonth(admin, CAANTA, 0);
    const expectedRemitCashA =
      PATH_A.employee + PATH_A.employer + PATH_A.tier2;

    results.push({
      name: "(a) Remit first posts full SSNIT cash once",
      ok:
        !remitA.error &&
        remitA.legsCleared === 3 &&
        r2(remitA.cashAmount) === r2(expectedRemitCashA) &&
        r2(cashAfterA - cashBeforeA) === r2(expectedRemitCashA),
      detail: JSON.stringify({
        remitA,
        cashDelta: r2(cashAfterA - cashBeforeA),
      }),
    });
    results.push({
      name: "(a) ESSNIT becomes Settled (No Cash Impact)",
      ok: isSettledNoCashImpactStatus(essnitAfterA?.payment_status),
      detail: String(essnitAfterA?.payment_status),
    });
    results.push({
      name: "(a) Mark as Paid not clickable after Remit",
      ok: !canMarkAutoPostedExpenseAsPaid(essnitAfterA ?? {}),
      detail: JSON.stringify({
        status: essnitAfterA?.payment_status,
        canMark: canMarkAutoPostedExpenseAsPaid(essnitAfterA ?? {}),
      }),
    });

    const markBlocked = await markAutoPostedExpensePaid(
      admin,
      essnitAfterA ?? seedA.essnit,
    );
    results.push({
      name: "(a) Mark as Paid API rejected after Remit",
      ok: Boolean(markBlocked.error) && markBlocked.taxLegsRemitted === 0,
      detail: JSON.stringify(markBlocked),
    });

    const { data: decoyAfterA } = await admin
      .from("tax_ledger_entries")
      .select("status, tax_amount, tenant_id")
      .eq("id", decoyId)
      .maybeSingle();
    results.push({
      name: "Isolation: Davors decoy untouched after Caanta Remit",
      ok:
        decoyAfterA?.tenant_id === DAVORS &&
        decoyAfterA?.status === "open" &&
        r2(Number(decoyAfterA?.tax_amount)) === 99,
      detail: JSON.stringify(decoyAfterA),
    });

    // --- (b) Mark as Paid first ---
    const seedB = await seedSsnitPeriod(admin, CAANTA, PATH_B, STAMP_B);
    taxIds.push(...seedB.ids);
    receiptNos.push(seedB.essnitReceipt);
    const remitReceiptB = buildRemitExpenseReceiptNo("ssnit", PATH_B.month);
    receiptNos.push(remitReceiptB);

    const cashBeforeMark = await cashOutflowForMonth(admin, CAANTA, 1); // Feb
    const markB = await markAutoPostedExpensePaid(admin, seedB.essnit);
    const { data: essnitAfterMark } = await admin
      .from("expense_register")
      .select("payment_status")
      .eq("id", seedB.essnit.id)
      .maybeSingle();
    const { data: legsAfterMark } = await admin
      .from("tax_ledger_entries")
      .select("tax_component, status")
      .eq("tenant_id", CAANTA)
      .eq("source_id", seedB.sourceId);
    const byComp = new Map(
      (legsAfterMark ?? []).map((row) => [row.tax_component, row.status]),
    );
    const cashAfterMark = await cashOutflowForMonth(admin, CAANTA, 1);

    results.push({
      name: "(b) Mark as Paid posts employer cash + remits employer legs",
      ok:
        !markB.error &&
        markB.taxLegsRemitted === 2 &&
        essnitAfterMark?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_PAID &&
        byComp.get("ssnit_employer_tier1") === "paid" &&
        byComp.get("ssnit_tier2") === "paid" &&
        byComp.get("ssnit_employee") === "open" &&
        r2(cashAfterMark - cashBeforeMark) === r2(seedB.essnitAmount),
      detail: JSON.stringify({
        markB,
        status: essnitAfterMark?.payment_status,
        tax: Object.fromEntries(byComp),
        cashDelta: r2(cashAfterMark - cashBeforeMark),
      }),
    });

    const cashBeforeRemitB = await cashOutflowForMonth(admin, CAANTA, 1);
    const remitB = await remitTaxForPeriod(admin, {
      tenantId: CAANTA,
      periodMonth: PATH_B.month,
      kind: "ssnit",
      settings,
    });
    const cashAfterRemitB = await cashOutflowForMonth(admin, CAANTA, 1);
    const { data: legsAfterRemitB } = await admin
      .from("tax_ledger_entries")
      .select("tax_component, status")
      .eq("tenant_id", CAANTA)
      .eq("source_id", seedB.sourceId);
    const byCompAfter = new Map(
      (legsAfterRemitB ?? []).map((row) => [row.tax_component, row.status]),
    );
    const { data: remitExpenseB } = await admin
      .from("expense_register")
      .select("amount, payment_status")
      .eq("tenant_id", CAANTA)
      .eq("receipt_no", remitReceiptB)
      .maybeSingle();

    results.push({
      name: "(b) Remit after Mark posts employee cash only (no employer double)",
      ok:
        !remitB.error &&
        remitB.essnitAligned === "already_paid" &&
        remitB.legsCleared === 1 &&
        r2(remitB.cashAmount) === r2(PATH_B.employee) &&
        r2(cashAfterRemitB - cashBeforeRemitB) === r2(PATH_B.employee) &&
        r2(Number(remitExpenseB?.amount) || 0) === r2(PATH_B.employee),
      detail: JSON.stringify({
        remitB,
        cashDelta: r2(cashAfterRemitB - cashBeforeRemitB),
        remitExpense: remitExpenseB,
      }),
    });
    results.push({
      name: "(b) All SSNIT legs remitted; no double-clear of employer",
      ok:
        byCompAfter.get("ssnit_employee") === "paid" &&
        byCompAfter.get("ssnit_employer_tier1") === "paid" &&
        byCompAfter.get("ssnit_tier2") === "paid",
      detail: JSON.stringify(Object.fromEntries(byCompAfter)),
    });

    const totalCashB = r2(cashAfterRemitB - cashBeforeMark);
    const expectedTotalB = r2(seedB.essnitAmount + PATH_B.employee);
    results.push({
      name: "(b) Total period cash = employer Mark + employee Remit (once each)",
      ok: totalCashB === expectedTotalB,
      detail: `total=${totalCashB} expected=${expectedTotalB}`,
    });

    const { data: decoyFinal } = await admin
      .from("tax_ledger_entries")
      .select("status, tax_amount, tenant_id, notes")
      .eq("id", decoyId)
      .maybeSingle();
    results.push({
      name: "Isolation: Davors decoy still open after full Caanta paths",
      ok:
        decoyFinal?.tenant_id === DAVORS &&
        decoyFinal?.status === "open" &&
        r2(Number(decoyFinal?.tax_amount)) === 99,
      detail: JSON.stringify(decoyFinal),
    });
  } finally {
    await cleanup(admin, taxIds, receiptNos);
    if (settingsBefore) {
      await admin
        .from("tax_settings")
        .update({
          next_ssnit_due_date: settingsBefore.next_ssnit_due_date,
          next_tier2_due_date: settingsBefore.next_tier2_due_date,
          next_paye_due_date: settingsBefore.next_paye_due_date,
          next_vat_due_date: settingsBefore.next_vat_due_date,
          next_wht_due_date: settingsBefore.next_wht_due_date,
          updated_at: settingsBefore.updated_at,
        })
        .eq("tenant_id", CAANTA);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== Caanta SSNIT double-path results ===");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} passed (staging ref=${ref}, tenant=${tenant.name})`,
  );
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
