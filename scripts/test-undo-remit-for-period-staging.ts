/**
 * Staging verification: Undo Remit-for-period (SSNIT / PAYE / VAT / WHT)
 * for Davors AND Caanta.
 *
 * Covers:
 *  - Remit → Undo: delete TAX-REMIT cash, reopen legs, restore ESSNIT Settled→Accrued
 *  - Mark as Paid then Remit → Undo: leave Mark-as-Paid ESSNIT cash; reopen employee only
 *  - Idempotent second undo
 *  - No cross-tenant / cross-period leakage
 *
 * Synthetic FY 2098 periods — does not mutate shared 2026 remittances.
 *
 * Usage:
 *   npx tsx scripts/test-undo-remit-for-period-staging.ts
 *   npx tsx scripts/test-undo-remit-for-period-staging.ts --env-file .env.staging.local
 *
 * STAGING ONLY — refuses production project refs. Cleans up its own rows.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  isAccruedPaymentStatus,
  isPaidStatus,
  isSettledNoCashImpactStatus,
} from "../app/dashboard/finance/accrued-wages-utils";
import { markAutoPostedExpensePaid } from "../app/dashboard/finance/register-auto-posted-utils";
import {
  buildRemitExpenseReceiptNo,
  remitTaxForPeriod,
  undoRemitTaxForPeriod,
  type RemitTaxKind,
} from "../app/dashboard/finance/tax-ledger-remit";
import { emptyTaxSettings } from "../app/dashboard/finance/tax-utils";
import {
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
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

const TENANTS = [
  { id: DAVORS, name: "Davors", key: "2098-03", month: "2098-03-01", end: "2098-03-31" },
  { id: CAANTA, name: "Caanta", key: "2098-04", month: "2098-04-01", end: "2098-04-30" },
] as const;

/** Separate period for Mark-as-Paid → Remit → Undo path (Davors only). */
const MARK_PAID_PERIOD = {
  key: "2098-05",
  month: "2098-05-01",
  end: "2098-05-31",
};

const AMOUNTS = {
  ssnit_employee: 121,
  ssnit_employer_tier1: 81,
  ssnit_tier2: 26,
  paye: 201,
  vat_output: 151,
  vat_input: 41,
  wht_payable: 56,
};

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

async function countStatus(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  periodMonth: string,
  components: string[],
  status: string,
  direction?: string,
) {
  let q = admin
    .from("tax_ledger_entries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("period_month", periodMonth)
    .eq("status", status)
    .in("tax_component", components);
  if (direction) q = q.eq("direction", direction);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function fetchExpense(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  receiptNo: string,
) {
  const { data, error } = await admin
    .from("expense_register")
    .select("id, amount, payment_status, receipt_no")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function cleanup(
  admin: ReturnType<typeof createClient>,
  taxIds: string[],
  expenses: Array<{ tenantId: string; receiptNo: string }>,
) {
  if (taxIds.length > 0) {
    await admin.from("tax_ledger_entries").delete().in("id", taxIds);
  }
  for (const exp of expenses) {
    await admin
      .from("expense_register")
      .delete()
      .eq("tenant_id", exp.tenantId)
      .eq("receipt_no", exp.receiptNo);
  }
}

async function seedPeriodLegs(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  period: { key: string; month: string; end: string },
  stamp: string,
  taxIds: string[],
  expenses: Array<{ tenantId: string; receiptNo: string }>,
) {
  const sourceId = buildPayrollPeriodTaxLedgerSourceId(period.month);

  for (const [component, amount] of [
    ["ssnit_employee", AMOUNTS.ssnit_employee],
    ["ssnit_employer_tier1", AMOUNTS.ssnit_employer_tier1],
    ["ssnit_tier2", AMOUNTS.ssnit_tier2],
  ] as const) {
    taxIds.push(
      await insertLeg(admin, {
        tenant_id: tenantId,
        entry_date: period.end,
        period_month: period.month,
        direction: "statutory_payable",
        tax_component: component,
        rate_pct: null,
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

  const essnitReceipt = buildPayrollExpenseReceiptNo("ESSNIT", period.key);
  expenses.push({ tenantId, receiptNo: essnitReceipt });
  const essnitAmount = AMOUNTS.ssnit_employer_tier1 + AMOUNTS.ssnit_tier2;
  const { error: essnitErr } = await admin.from("expense_register").insert({
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
  });
  if (essnitErr) throw new Error(essnitErr.message);

  taxIds.push(
    await insertLeg(admin, {
      tenant_id: tenantId,
      entry_date: period.end,
      period_month: period.month,
      direction: "statutory_payable",
      tax_component: "paye",
      rate_pct: null,
      taxable_base: AMOUNTS.paye * 5,
      tax_amount: AMOUNTS.paye,
      status: "open",
      source_type: PAYROLL_PERIOD_SOURCE_TYPE,
      source_id: sourceId,
      counterparty_name: "GRA",
      notes: stamp,
    }),
  );

  taxIds.push(
    await insertLeg(admin, {
      tenant_id: tenantId,
      entry_date: period.end,
      period_month: period.month,
      direction: "output",
      tax_component: "vat_bundle",
      rate_pct: 15,
      taxable_base: 1000,
      tax_amount: AMOUNTS.vat_output,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "GRA",
      notes: stamp,
    }),
  );
  taxIds.push(
    await insertLeg(admin, {
      tenant_id: tenantId,
      entry_date: period.end,
      period_month: period.month,
      direction: "input",
      tax_component: "vat_bundle",
      rate_pct: 15,
      taxable_base: 266.67,
      tax_amount: AMOUNTS.vat_input,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "Supplier",
      notes: stamp,
    }),
  );

  taxIds.push(
    await insertLeg(admin, {
      tenant_id: tenantId,
      entry_date: period.end,
      period_month: period.month,
      direction: "wht_payable",
      tax_component: "wht",
      rate_pct: 5,
      taxable_base: 1100,
      tax_amount: AMOUNTS.wht_payable,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "GRA",
      notes: stamp,
    }),
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = projectRefFromUrl(url);
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!ref || PRODUCTION_PROJECT_REFS.has(ref)) {
    throw new Error(`Refusing to run on production/unknown ref: ${ref}`);
  }
  if (ref !== STAGING_PROJECT_REF) {
    console.warn(`[undo-remit] Unexpected staging ref ${ref} (expected ${STAGING_PROJECT_REF})`);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: Result[] = [];
  const taxIds: string[] = [];
  const expenses: Array<{ tenantId: string; receiptNo: string }> = [];

  const expectedSsnit =
    AMOUNTS.ssnit_employee +
    AMOUNTS.ssnit_employer_tier1 +
    AMOUNTS.ssnit_tier2;
  const expectedVat = r2(AMOUNTS.vat_output - AMOUNTS.vat_input);

  const kinds: Array<{
    kind: RemitTaxKind;
    expectedCash: number;
    expectedLegs: number;
    components: string[];
    direction?: string;
  }> = [
    {
      kind: "ssnit",
      expectedCash: expectedSsnit,
      expectedLegs: 3,
      components: ["ssnit_employee", "ssnit_employer_tier1", "ssnit_tier2"],
    },
    {
      kind: "paye",
      expectedCash: AMOUNTS.paye,
      expectedLegs: 1,
      components: ["paye"],
    },
    {
      kind: "vat",
      expectedCash: expectedVat,
      expectedLegs: 2,
      components: ["vat_bundle", "vfrs"],
    },
    {
      kind: "wht",
      expectedCash: AMOUNTS.wht_payable,
      expectedLegs: 1,
      components: ["wht"],
      direction: "wht_payable",
    },
  ];

  try {
    // --- Dual-tenant remit → undo for all four types ---
    for (const tenant of TENANTS) {
      const stamp = `TEST-UNDO-REMIT-${tenant.name}-${tenant.key}`;
      console.log(`\n[undo-remit] seed ${tenant.name} ${tenant.key}…`);
      await seedPeriodLegs(admin, tenant.id, tenant, stamp, taxIds, expenses);

      // Decoy on the OTHER tenant same period — must stay open through undo.
      const otherId = tenant.id === DAVORS ? CAANTA : DAVORS;
      taxIds.push(
        await insertLeg(admin, {
          tenant_id: otherId,
          entry_date: tenant.end,
          period_month: tenant.month,
          direction: "statutory_payable",
          tax_component: "paye",
          rate_pct: null,
          taxable_base: 888,
          tax_amount: 88,
          status: "open",
          source_type: "manual",
          source_id: null,
          counterparty_name: "ISO",
          notes: `${stamp}-DECOY`,
        }),
      );

      const settings = emptyTaxSettings(tenant.id);

      for (const spec of kinds) {
        const remitReceipt = buildRemitExpenseReceiptNo(spec.kind, tenant.month);
        expenses.push({ tenantId: tenant.id, receiptNo: remitReceipt });

        const remit = await remitTaxForPeriod(admin, {
          tenantId: tenant.id,
          periodMonth: tenant.month,
          kind: spec.kind,
          settings,
        });

        results.push({
          name: `${tenant.name} Remit ${spec.kind.toUpperCase()}`,
          ok: !remit.error && remit.legsCleared === spec.expectedLegs && r2(remit.cashAmount) === spec.expectedCash,
          detail: remit.error ?? `legs=${remit.legsCleared} cash=${remit.cashAmount} aligned=${remit.essnitAligned}`,
        });

        if (spec.kind === "ssnit") {
          const essnit = await fetchExpense(
            admin,
            tenant.id,
            buildPayrollExpenseReceiptNo("ESSNIT", tenant.key),
          );
          results.push({
            name: `${tenant.name} ESSNIT Settled after Remit`,
            ok: Boolean(essnit && isSettledNoCashImpactStatus(essnit.payment_status)),
            detail: essnit?.payment_status ?? "missing",
          });
        }

        const undo = await undoRemitTaxForPeriod(admin, {
          tenantId: tenant.id,
          periodMonth: tenant.month,
          kind: spec.kind,
        });

        results.push({
          name: `${tenant.name} Undo Remit ${spec.kind.toUpperCase()}`,
          ok:
            !undo.error &&
            undo.expenseDeleted &&
            undo.legsReopened === spec.expectedLegs &&
            r2(undo.cashAmountReversed) === spec.expectedCash,
          detail: undo.error ?? undo.message ?? JSON.stringify(undo),
        });

        const remittanceGone = await fetchExpense(admin, tenant.id, remitReceipt);
        results.push({
          name: `${tenant.name} TAX-REMIT ${spec.kind.toUpperCase()} deleted`,
          ok: remittanceGone == null,
          detail: remittanceGone ? `still exists ${remittanceGone.receipt_no}` : "gone",
        });

        const openAgain = await countStatus(
          admin,
          tenant.id,
          tenant.month,
          spec.components,
          "open",
          spec.direction,
        );
        results.push({
          name: `${tenant.name} ${spec.kind.toUpperCase()} legs reopened`,
          ok: openAgain === spec.expectedLegs,
          detail: `open=${openAgain} expected=${spec.expectedLegs}`,
        });

        if (spec.kind === "ssnit") {
          const essnit = await fetchExpense(
            admin,
            tenant.id,
            buildPayrollExpenseReceiptNo("ESSNIT", tenant.key),
          );
          results.push({
            name: `${tenant.name} ESSNIT restored Accrued after Undo`,
            ok: Boolean(essnit && isAccruedPaymentStatus(essnit.payment_status)),
            detail: essnit?.payment_status ?? "missing",
          });
          results.push({
            name: `${tenant.name} Undo essnitRestored=accrued`,
            ok: undo.essnitRestored === "accrued",
            detail: String(undo.essnitRestored),
          });
        }

        const second = await undoRemitTaxForPeriod(admin, {
          tenantId: tenant.id,
          periodMonth: tenant.month,
          kind: spec.kind,
        });
        results.push({
          name: `${tenant.name} Undo ${spec.kind.toUpperCase()} idempotent`,
          ok: !second.error && !second.expenseDeleted && second.legsReopened === 0,
          detail: second.message ?? second.error ?? "ok",
        });
      }

      // Decoy still open on other tenant
      const decoyOpen = await countStatus(
        admin,
        otherId,
        tenant.month,
        ["paye"],
        "open",
      );
      results.push({
        name: `${tenant.name} other-tenant PAYE decoy untouched`,
        ok: decoyOpen >= 1,
        detail: `other open paye=${decoyOpen}`,
      });
    }

    // --- Mark as Paid first → Remit employee → Undo leaves Mark-as-Paid cash ---
    console.log(`\n[undo-remit] Mark-as-Paid guard path (${MARK_PAID_PERIOD.key})…`);
    const mpStamp = `TEST-UNDO-REMIT-MARKPAID-${MARK_PAID_PERIOD.key}`;
    await seedPeriodLegs(admin, DAVORS, MARK_PAID_PERIOD, mpStamp, taxIds, expenses);

    const essnitReceipt = buildPayrollExpenseReceiptNo("ESSNIT", MARK_PAID_PERIOD.key);
    const { data: essnitRow } = await admin
      .from("expense_register")
      .select("id, tenant_id, receipt_no, payment_status, description")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", essnitReceipt)
      .single();

    const mark = await markAutoPostedExpensePaid(admin, essnitRow!);
    results.push({
      name: "Mark as Paid ESSNIT succeeds",
      ok: !mark.error && mark.taxLegsRemitted >= 1,
      detail: mark.error ?? `taxLegs=${mark.taxLegsRemitted}`,
    });

    const essnitAfterMark = await fetchExpense(admin, DAVORS, essnitReceipt);
    const essnitPaidAmount = Number(essnitAfterMark?.amount) || 0;
    results.push({
      name: "ESSNIT is Paid after Mark as Paid",
      ok: Boolean(essnitAfterMark && isPaidStatus(essnitAfterMark.payment_status)),
      detail: essnitAfterMark?.payment_status ?? "missing",
    });

    const settings = emptyTaxSettings(DAVORS);
    const remitEmployee = await remitTaxForPeriod(admin, {
      tenantId: DAVORS,
      periodMonth: MARK_PAID_PERIOD.month,
      kind: "ssnit",
      settings,
    });
    const remitReceipt = buildRemitExpenseReceiptNo("ssnit", MARK_PAID_PERIOD.month);
    expenses.push({ tenantId: DAVORS, receiptNo: remitReceipt });

    results.push({
      name: "Remit after Mark as Paid posts employee cash only",
      ok:
        !remitEmployee.error &&
        r2(remitEmployee.cashAmount) === AMOUNTS.ssnit_employee &&
        remitEmployee.expenseInserted,
      detail: remitEmployee.error ?? `cash=${remitEmployee.cashAmount} legs=${remitEmployee.legsCleared}`,
    });

    const undoAfterMark = await undoRemitTaxForPeriod(admin, {
      tenantId: DAVORS,
      periodMonth: MARK_PAID_PERIOD.month,
      kind: "ssnit",
    });

    results.push({
      name: "Undo after Mark as Paid leaves ESSNIT Paid",
      ok: undoAfterMark.essnitRestored === "left_paid" && !undoAfterMark.error,
      detail: undoAfterMark.error ?? `restored=${undoAfterMark.essnitRestored} msg=${undoAfterMark.message}`,
    });

    const essnitAfterUndo = await fetchExpense(admin, DAVORS, essnitReceipt);
    results.push({
      name: "Mark-as-Paid ESSNIT cash row still Paid (not deleted)",
      ok:
        Boolean(essnitAfterUndo) &&
        isPaidStatus(essnitAfterUndo?.payment_status) &&
        r2(Number(essnitAfterUndo?.amount) || 0) === r2(essnitPaidAmount),
      detail: essnitAfterUndo
        ? `${essnitAfterUndo.payment_status} amount=${essnitAfterUndo.amount}`
        : "ESSNIT missing",
    });

    const remittanceGone = await fetchExpense(admin, DAVORS, remitReceipt);
    results.push({
      name: "TAX-REMIT-SSNIT deleted; PAYROLL-ESSNIT kept",
      ok: remittanceGone == null && Boolean(essnitAfterUndo),
      detail: remittanceGone ? "remit still present" : "remit gone, essnit kept",
    });

    const employeeOpen = await countStatus(
      admin,
      DAVORS,
      MARK_PAID_PERIOD.month,
      ["ssnit_employee"],
      "open",
    );
    const employerStillPaid = await countStatus(
      admin,
      DAVORS,
      MARK_PAID_PERIOD.month,
      ["ssnit_employer_tier1", "ssnit_tier2"],
      "paid",
    );
    results.push({
      name: "Undo reopens employee SSNIT only; employer stays remitted",
      ok: employeeOpen === 1 && employerStillPaid === 2,
      detail: `employeeOpen=${employeeOpen} employerPaid=${employerStillPaid}`,
    });

    // Cross-period: undoing 2098-05 must not reopen 2098-03 Davors legs if any remitted
    // (they were remitted then undone already — all open). Seed a remitted decoy on other period.
    const crossPeriod = "2098-06-01";
    const crossEnd = "2098-06-30";
    const crossId = await insertLeg(admin, {
      tenant_id: DAVORS,
      entry_date: crossEnd,
      period_month: crossPeriod,
      direction: "statutory_payable",
      tax_component: "paye",
      rate_pct: null,
      taxable_base: 50,
      tax_amount: 50,
      status: "paid",
      remitted_at: crossEnd,
      source_type: "manual",
      source_id: null,
      counterparty_name: "GRA",
      notes: "TEST-UNDO-REMIT-CROSS-PERIOD [Remitted 2098-06-30]",
    });
    taxIds.push(crossId);

    // Trigger undo on mark-paid period again (idempotent) and confirm cross period still paid
    await undoRemitTaxForPeriod(admin, {
      tenantId: DAVORS,
      periodMonth: MARK_PAID_PERIOD.month,
      kind: "paye",
    });
    const { data: crossRow } = await admin
      .from("tax_ledger_entries")
      .select("status")
      .eq("id", crossId)
      .single();
    results.push({
      name: "No cross-period leakage (2098-06 PAYE stays paid)",
      ok: crossRow?.status === "paid",
      detail: crossRow?.status ?? "missing",
    });
  } finally {
    console.log("\n[undo-remit] cleanup…");
    await cleanup(admin, taxIds, expenses);
  }

  console.log("\n=== Undo Remit staging results ===");
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failed += 1;
    console.log(`${mark}  ${r.name} — ${r.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
