/**
 * Staging verification: Remit-for-period (SSNIT / PAYE / VAT / WHT).
 *
 * Approach: SYNTHETIC June/July mirrors on FY 2099 (2099-06 / 2099-07) so shared
 * staging June/July 2026 Davors remittances are NOT permanently altered.
 * Also probes live 2026-06 / 2026-07 open balances (read-only).
 *
 * Usage:
 *   npx tsx scripts/test-remit-for-period-staging.ts
 *   npx tsx scripts/test-remit-for-period-staging.ts --env-file .env.staging.local
 *
 * STAGING ONLY — refuses production project refs. Cleans up its own rows.
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
  getBalanceCheckForPeriod,
  buildBalanceSheetReport,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  buildRemitExpenseReceiptNo,
  remitTaxForPeriod,
  type RemitTaxKind,
} from "../app/dashboard/finance/tax-ledger-remit";
import {
  buildPayrollPeriodTaxLedgerSourceId,
  PAYROLL_PERIOD_SOURCE_TYPE,
} from "../app/dashboard/hr-payroll/payroll-statutory-ledger-sync";
import { emptyTaxSettings } from "../app/dashboard/finance/tax-utils";

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
const OTHER_TENANT = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b"; // Caanta
const FY = 2099;

/** Synthetic June / July mirrors — avoids mutating shared 2026 staging remittances. */
const PERIODS = [
  {
    key: "2099-06",
    month: "2099-06-01",
    end: "2099-06-30",
    label: "June (synthetic)",
  },
  {
    key: "2099-07",
    month: "2099-07-01",
    end: "2099-07-31",
    label: "July (synthetic)",
  },
] as const;

const LIVE_PROBE_PERIODS = ["2026-06-01", "2026-07-01"];

const AMOUNTS = {
  ssnit_employee: 120,
  ssnit_employer_tier1: 80,
  ssnit_tier2: 25,
  paye: 200,
  vat_output: 150,
  vat_input: 40,
  wht_payable: 55,
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

async function openTaxSum(
  admin: ReturnType<typeof createClient>,
  periodMonth: string,
  components: string[],
  direction?: string,
) {
  let q = admin
    .from("tax_ledger_entries")
    .select("tax_amount, direction, tax_component, status")
    .eq("tenant_id", DAVORS)
    .eq("period_month", periodMonth)
    .eq("status", "open")
    .in("tax_component", components);
  if (direction) q = q.eq("direction", direction);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return r2(
    (data ?? []).reduce((s, row) => s + (Number(row.tax_amount) || 0), 0),
  );
}

async function cleanup(
  admin: ReturnType<typeof createClient>,
  taxIds: string[],
  receiptNos: string[],
) {
  if (taxIds.length > 0) {
    await admin.from("tax_ledger_entries").delete().in("id", taxIds);
  }
  if (receiptNos.length > 0) {
    await admin
      .from("expense_register")
      .delete()
      .eq("tenant_id", DAVORS)
      .in("receipt_no", receiptNos);
    await admin
      .from("expense_register")
      .delete()
      .eq("tenant_id", OTHER_TENANT)
      .in("receipt_no", receiptNos);
  }
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
    console.warn(`[remit-period] Unexpected staging ref ${ref} (expected ${STAGING_PROJECT_REF})`);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: Result[] = [];
  const taxIds: string[] = [];
  const receiptNos: string[] = [];

  console.log("[remit-period] probe live June/July 2026 open balances (read-only)…");
  for (const period of LIVE_PROBE_PERIODS) {
    const ssnit = await openTaxSum(admin, period, [
      "ssnit_employee",
      "ssnit_employer_tier1",
      "ssnit_tier2",
    ]);
    const paye = await openTaxSum(admin, period, ["paye"]);
    const vatOut = await openTaxSum(admin, period, ["vat_bundle", "vfrs"], "output");
    const vatIn = await openTaxSum(admin, period, ["vat_bundle", "vfrs"], "input");
    const wht = await openTaxSum(admin, period, ["wht"], "wht_payable");
    console.log(
      `  ${period}: SSNIT open=${ssnit} PAYE=${paye} VAT net=${r2(vatOut - vatIn)} WHT pay=${wht}`,
    );
  }

  const settings = emptyTaxSettings(DAVORS);

  try {
    for (const period of PERIODS) {
      const monthIndex = Number(period.key.slice(5, 7)) - 1;
      const sourceId = buildPayrollPeriodTaxLedgerSourceId(period.month);
      const stamp = `TEST-REMIT-${period.key}`;

      console.log(`\n[remit-period] seed ${period.label} (${period.key})…`);

      // SSNIT legs + Accrued ESSNIT
      for (const [component, amount] of [
        ["ssnit_employee", AMOUNTS.ssnit_employee],
        ["ssnit_employer_tier1", AMOUNTS.ssnit_employer_tier1],
        ["ssnit_tier2", AMOUNTS.ssnit_tier2],
      ] as const) {
        taxIds.push(
          await insertLeg(admin, {
            tenant_id: DAVORS,
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

      const essnitReceipt = `PAYROLL-ESSNIT-${period.key}`;
      receiptNos.push(essnitReceipt);
      const essnitAmount =
        AMOUNTS.ssnit_employer_tier1 + AMOUNTS.ssnit_tier2;
      const { error: essnitErr } = await admin.from("expense_register").insert({
        tenant_id: DAVORS,
        date: period.end,
        expense_category: "Employer SSNIT Contribution",
        sub_category: "Payroll",
        description: `Auto-posted from Payroll ${period.label}`,
        vendor: "SSNIT",
        price: essnitAmount,
        quantity: 1,
        amount: essnitAmount,
        payment_method: "Accrual",
        approved_by: "System",
        receipt_no: essnitReceipt,
        payment_status: "Accrued - Not Yet Paid",
        notes: stamp,
      });
      if (essnitErr) throw new Error(essnitErr.message);

      // PAYE
      taxIds.push(
        await insertLeg(admin, {
          tenant_id: DAVORS,
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

      // VAT output + input
      taxIds.push(
        await insertLeg(admin, {
          tenant_id: DAVORS,
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
          tenant_id: DAVORS,
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

      // WHT payable
      taxIds.push(
        await insertLeg(admin, {
          tenant_id: DAVORS,
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

      // Other-tenant decoy (must not be remitted)
      taxIds.push(
        await insertLeg(admin, {
          tenant_id: OTHER_TENANT,
          entry_date: period.end,
          period_month: period.month,
          direction: "statutory_payable",
          tax_component: "paye",
          rate_pct: null,
          taxable_base: 999,
          tax_amount: 99,
          status: "open",
          source_type: "manual",
          source_id: null,
          counterparty_name: "ISO",
          notes: `${stamp}-OTHER`,
        }),
      );

      const expectedSsnit =
        AMOUNTS.ssnit_employee +
        AMOUNTS.ssnit_employer_tier1 +
        AMOUNTS.ssnit_tier2;
      const expectedVat = r2(AMOUNTS.vat_output - AMOUNTS.vat_input);

      const kinds: Array<{
        kind: RemitTaxKind;
        expectedCash: number;
        expectedLegs: number;
      }> = [
        { kind: "ssnit", expectedCash: expectedSsnit, expectedLegs: 3 },
        { kind: "paye", expectedCash: AMOUNTS.paye, expectedLegs: 1 },
        { kind: "vat", expectedCash: expectedVat, expectedLegs: 2 },
        { kind: "wht", expectedCash: AMOUNTS.wht_payable, expectedLegs: 1 },
      ];

      for (const { kind, expectedCash, expectedLegs } of kinds) {
        const cashBefore = await cashOutflowForMonth(admin, monthIndex);
        console.log(`[remit-period] Remit ${kind} ${period.key}…`);
        const result = await remitTaxForPeriod(admin, {
          tenantId: DAVORS,
          periodMonth: period.month,
          kind,
          settings,
        });

        const receipt = buildRemitExpenseReceiptNo(kind, period.month);
        receiptNos.push(receipt);

        results.push({
          name: `${period.label} Remit ${kind.toUpperCase()} succeeds`,
          ok: !result.error && result.legsCleared === expectedLegs,
          detail: result.error
            ? result.error
            : `legs=${result.legsCleared} cash=${result.cashAmount} msg=${result.message}`,
        });

        results.push({
          name: `${period.label} Remit ${kind.toUpperCase()} cash amount`,
          ok: r2(result.cashAmount) === r2(expectedCash),
          detail: `got=${result.cashAmount} expected=${expectedCash}`,
        });

        const cashAfter = await cashOutflowForMonth(admin, monthIndex);
        results.push({
          name: `${period.label} Remit ${kind.toUpperCase()} Cash Position delta`,
          ok: r2(cashAfter - cashBefore) === r2(expectedCash),
          detail: `delta=${r2(cashAfter - cashBefore)} expected=${expectedCash}`,
        });

        const { data: remittanceExpense } = await admin
          .from("expense_register")
          .select("payment_status, amount, expense_category")
          .eq("tenant_id", DAVORS)
          .eq("receipt_no", receipt)
          .maybeSingle();

        results.push({
          name: `${period.label} Remit ${kind.toUpperCase()} expense Paid Statutory Remittance`,
          ok:
            remittanceExpense?.payment_status === "Paid" &&
            remittanceExpense?.expense_category === "Statutory Remittance" &&
            r2(Number(remittanceExpense?.amount)) === r2(expectedCash),
          detail: JSON.stringify(remittanceExpense),
        });

        results.push({
          name: `${period.label} Remit ${kind.toUpperCase()} is cash outflow`,
          ok: isCashOutflowExpense({
            payment_status: remittanceExpense?.payment_status,
            receipt_no: receipt,
            amount: remittanceExpense?.amount,
          }),
          detail: String(remittanceExpense?.payment_status),
        });
      }

      // Liability clear assertions
      const openSsnit = await openTaxSum(admin, period.month, [
        "ssnit_employee",
        "ssnit_employer_tier1",
        "ssnit_tier2",
      ]);
      const openPaye = await openTaxSum(admin, period.month, ["paye"]);
      const openVat = await openTaxSum(admin, period.month, [
        "vat_bundle",
        "vfrs",
      ]);
      const openWht = await openTaxSum(admin, period.month, ["wht"], "wht_payable");

      results.push({
        name: `${period.label} all Davors liabilities cleared`,
        ok:
          openSsnit === 0 &&
          openPaye === 0 &&
          openVat === 0 &&
          openWht === 0,
        detail: `ssnit=${openSsnit} paye=${openPaye} vat=${openVat} wht=${openWht}`,
      });

      const { data: otherPaye } = await admin
        .from("tax_ledger_entries")
        .select("status, tax_amount")
        .eq("tenant_id", OTHER_TENANT)
        .eq("period_month", period.month)
        .eq("tax_component", "paye")
        .eq("notes", `${stamp}-OTHER`)
        .maybeSingle();

      results.push({
        name: `${period.label} other-tenant PAYE untouched`,
        ok: otherPaye?.status === "open" && r2(Number(otherPaye?.tax_amount)) === 99,
        detail: JSON.stringify(otherPaye),
      });

      const { data: essnitAfter } = await admin
        .from("expense_register")
        .select("payment_status")
        .eq("tenant_id", DAVORS)
        .eq("receipt_no", essnitReceipt)
        .maybeSingle();

      results.push({
        name: `${period.label} ESSNIT Settled (No Cash Impact)`,
        ok: isSettledNoCashImpactStatus(essnitAfter?.payment_status),
        detail: String(essnitAfter?.payment_status),
      });

      // Remittance effect: cash outflow equals liability cleared (BS-neutral pairing).
      // Absolute BS balance on a synthetic slice is not meaningful (missing wages/revenue legs).
      const totalRemitted =
        expectedSsnit + AMOUNTS.paye + expectedVat + AMOUNTS.wht_payable;
      const cashEnd = await cashOutflowForMonth(admin, monthIndex);
      // cashEnd includes only Paid remittance rows in FY 2099 for our receipts
      // (ESSNIT Settled does not contribute). Compare period paid-expense total to remitted total
      // by summing remittance receipts directly.
      const remitReceipts = [
        buildRemitExpenseReceiptNo("ssnit", period.month),
        buildRemitExpenseReceiptNo("paye", period.month),
        buildRemitExpenseReceiptNo("vat", period.month),
        buildRemitExpenseReceiptNo("wht", period.month),
      ];
      const { data: remitRows } = await admin
        .from("expense_register")
        .select("amount, payment_status")
        .eq("tenant_id", DAVORS)
        .in("receipt_no", remitReceipts);
      const remitCashSum = r2(
        (remitRows ?? []).reduce((s, row) => s + (Number(row.amount) || 0), 0),
      );

      results.push({
        name: `${period.label} cash↔liability pairing (BS-neutral remit effect)`,
        ok: remitCashSum === r2(totalRemitted) && openSsnit === 0,
        detail: `remitCash=${remitCashSum} clearedLiability=${totalRemitted} paidExpensesMonth=${cashEnd}`,
      });

      // Keep a full BS builder smoke call (should not throw); difference may be non-zero on slice.
      const { data: taxForBs } = await admin
        .from("tax_ledger_entries")
        .select("entry_date, direction, tax_component, tax_amount, status")
        .eq("tenant_id", DAVORS)
        .eq("status", "open");

      const { data: expensesForBs } = await admin
        .from("expense_register")
        .select(
          "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
        )
        .eq("tenant_id", DAVORS)
        .in("receipt_no", [essnitReceipt, ...remitReceipts]);

      const report = buildBalanceSheetReport(
        [],
        (expensesForBs ?? []).map((e) => ({
          date: e.date,
          expense_category: e.expense_category,
          sub_category: e.sub_category,
          amount: Number(e.amount) || 0,
          net_of_tax_amount: e.net_of_tax_amount,
          input_vat_amount: e.input_vat_amount,
        })),
        [],
        [],
        [],
        (expensesForBs ?? []).map((e) => ({
          date: e.date,
          expense_category: e.expense_category,
          sub_category: e.sub_category,
          amount: Number(e.amount) || 0,
          payment_status: e.payment_status,
          description: e.description,
          receipt_no: e.receipt_no,
          notes: e.notes,
          net_of_tax_amount: e.net_of_tax_amount,
          input_vat_amount: e.input_vat_amount,
        })),
        [],
        [],
        FY,
        {
          config: null,
          rawMaterials: [],
          finishedProducts: [],
          finishedProductAverageCosts: [],
          cashPurchases: [],
          productCashPurchases: [],
        },
        [],
        taxForBs ?? [],
      );

      const check = getBalanceCheckForPeriod(report, monthIndex);
      results.push({
        name: `${period.label} BS builder runs after remits`,
        ok: Number.isFinite(check.difference),
        detail: `assets=${check.totalAssets} L+E=${check.totalLiabilitiesAndEquity} diff=${check.difference} (slice incomplete by design)`,
      });

      // Idempotency: second remit should refuse
      const second = await remitTaxForPeriod(admin, {
        tenantId: DAVORS,
        periodMonth: period.month,
        kind: "paye",
        settings,
      });
      results.push({
        name: `${period.label} second PAYE remit blocked`,
        ok: Boolean(second.error || second.message?.includes("No open")),
        detail: second.error ?? second.message ?? "",
      });
    }
  } finally {
    console.log("\n[remit-period] cleanup…");
    await cleanup(admin, taxIds, [...new Set(receiptNos)]);
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.detail}`);
  }
  console.log(
    `\n[remit-period] ${results.length - failed.length}/${results.length} passed`,
  );
  console.log(
    "Approach: synthetic 2099-06/07 (June/July mirrors). Live 2026-06/07 probed read-only only. Production untouched.",
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
