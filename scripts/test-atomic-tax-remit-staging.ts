/**
 * Staging soak + atomicity + parity for atomic tax remit RPCs.
 *
 *   npx tsx scripts/test-atomic-tax-remit-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  buildRemitExpenseReceiptNo,
  computeRemitCashAmount,
  type RemitTaxKind,
} from "../app/dashboard/finance/tax-ledger-remit";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const SQL_FILE = "scripts/281_atomic_tax_remit.sql";
const TEST_TRIGGER = "trg_test_atomic_tax_remit_block";
const PERIOD = "2099-08-01";
const PERIOD_KEY = "2099-08";
const STAMP = "TEST-ATOMIC-REMIT-2099-08";

const AMOUNTS = {
  ssnit_employee: 120,
  ssnit_employer_tier1: 80,
  ssnit_tier2: 25,
  paye: 200,
  vat_output: 150,
  vat_input: 40,
  wht_payable: 55,
};

function loadEnvForce(filePath: string) {
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

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function ensureMigration(pgClient) {
  const { rows } = await pgClient.query(
    `SELECT count(*)::int AS cnt FROM pg_proc WHERE proname = 'remit_tax_for_period'`,
  );
  if ((rows[0]?.cnt ?? 0) < 1) {
    await pgClient.query(readFileSync(resolve(SQL_FILE), "utf8"));
    console.log("Applied migration 281");
  }
}

async function cleanup(admin, pgClient) {
  await pgClient.query(
    `DELETE FROM tax_ledger_entries WHERE tenant_id = $1 AND notes LIKE $2`,
    [DAVORS, `${STAMP}%`],
  );
  await pgClient.query(
    `DELETE FROM expense_register WHERE tenant_id = $1 AND (notes LIKE $2 OR receipt_no LIKE 'TAX-REMIT-%-${PERIOD_KEY}')`,
    [DAVORS, `${STAMP}%`],
  );
}

async function insertLeg(admin, row) {
  const { data, error } = await admin
    .from("tax_ledger_entries")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function seedPeriod(admin) {
  const end = "2099-08-31";
  const ids = [];

  for (const [component, amount] of [
    ["ssnit_employee", AMOUNTS.ssnit_employee],
    ["ssnit_employer_tier1", AMOUNTS.ssnit_employer_tier1],
    ["ssnit_tier2", AMOUNTS.ssnit_tier2],
  ]) {
    ids.push(
      await insertLeg(admin, {
        tenant_id: DAVORS,
        entry_date: end,
        period_month: PERIOD,
        direction: "statutory_payable",
        tax_component: component,
        tax_amount: amount,
        taxable_base: amount * 10,
        status: "open",
        source_type: "manual",
        source_id: null,
        counterparty_name: "SSNIT",
        notes: STAMP,
      }),
    );
  }

  const essnitAmount = AMOUNTS.ssnit_employer_tier1 + AMOUNTS.ssnit_tier2;
  const { error: essnitErr } = await admin.from("expense_register").insert({
    tenant_id: DAVORS,
    date: end,
    expense_category: "Employer SSNIT Contribution",
    sub_category: "Payroll",
    description: "Test ESSNIT accrual",
    vendor: "SSNIT",
    price: essnitAmount,
    quantity: 1,
    amount: essnitAmount,
    payment_method: "Accrual",
    approved_by: "System",
    receipt_no: `PAYROLL-ESSNIT-${PERIOD_KEY}`,
    payment_status: "Accrued - Not Yet Paid",
    notes: STAMP,
  });
  if (essnitErr) throw new Error(essnitErr.message);

  ids.push(
    await insertLeg(admin, {
      tenant_id: DAVORS,
      entry_date: end,
      period_month: PERIOD,
      direction: "statutory_payable",
      tax_component: "paye",
      tax_amount: AMOUNTS.paye,
      taxable_base: AMOUNTS.paye * 5,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "GRA",
      notes: STAMP,
    }),
  );

  ids.push(
    await insertLeg(admin, {
      tenant_id: DAVORS,
      entry_date: end,
      period_month: PERIOD,
      direction: "output",
      tax_component: "vat_bundle",
      tax_amount: AMOUNTS.vat_output,
      taxable_base: 1000,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "GRA",
      notes: STAMP,
    }),
  );
  ids.push(
    await insertLeg(admin, {
      tenant_id: DAVORS,
      entry_date: end,
      period_month: PERIOD,
      direction: "input",
      tax_component: "vat_bundle",
      tax_amount: AMOUNTS.vat_input,
      taxable_base: 266.67,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "Supplier",
      notes: STAMP,
    }),
  );

  ids.push(
    await insertLeg(admin, {
      tenant_id: DAVORS,
      entry_date: end,
      period_month: PERIOD,
      direction: "wht_payable",
      tax_component: "wht",
      tax_amount: AMOUNTS.wht_payable,
      taxable_base: 1100,
      status: "open",
      source_type: "manual",
      source_id: null,
      counterparty_name: "GRA",
      notes: STAMP,
    }),
  );

  return ids;
}

async function fetchOpenLegs(admin, kind) {
  const components =
    kind === "ssnit"
      ? ["ssnit_employee", "ssnit_employer_tier1", "ssnit_tier2"]
      : kind === "paye"
        ? ["paye"]
        : kind === "vat"
          ? ["vat_bundle", "vfrs"]
          : ["wht"];

  let query = admin
    .from("tax_ledger_entries")
    .select("id, direction, tax_component, tax_amount, status, notes")
    .eq("tenant_id", DAVORS)
    .eq("period_month", PERIOD)
    .eq("status", "open")
    .in("tax_component", components)
    .like("notes", `${STAMP}%`);

  if (kind === "wht") query = query.eq("direction", "wht_payable");

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function installAtomicityTrigger(pgClient) {
  await pgClient.query(`
    CREATE OR REPLACE FUNCTION public.${TEST_TRIGGER}_fn()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.notes LIKE '${STAMP}-ATOMIC-BLOCK%' THEN
        RAISE EXCEPTION 'TEST_ATOMICITY_BLOCK';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await pgClient.query(`
    DROP TRIGGER IF EXISTS ${TEST_TRIGGER} ON public.tax_ledger_entries;
    CREATE TRIGGER ${TEST_TRIGGER}
      BEFORE UPDATE ON public.tax_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION public.${TEST_TRIGGER}_fn();
  `);
}

async function removeAtomicityTrigger(pgClient) {
  await pgClient.query(`DROP TRIGGER IF EXISTS ${TEST_TRIGGER} ON public.tax_ledger_entries`);
  await pgClient.query(`DROP FUNCTION IF EXISTS public.${TEST_TRIGGER}_fn()`);
}

async function remitRpc(admin, kind) {
  const { data, error } = await admin.rpc("remit_tax_for_period", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_period_month: PERIOD,
    p_kind: kind,
    p_view_all_business_units: false,
  });
  if (error) throw new Error(`${kind} RPC: ${error.message}`);
  return data;
}

async function undoRpc(admin, kind) {
  const { data, error } = await admin.rpc("undo_remit_tax_for_period", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_period_month: PERIOD,
    p_kind: kind,
  });
  if (error) throw new Error(`${kind} undo RPC: ${error.message}`);
  return data;
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes(STAGING_REF)) throw new Error("Refusing: not staging");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const pgClient = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const results = [];

  try {
    await ensureMigration(pgClient);
    await cleanup(admin, pgClient);
    await seedPeriod(admin);

    const kinds = ["ssnit", "paye", "vat", "wht"];
    for (const kind of kinds) {
      const openLegs = await fetchOpenLegs(admin, kind);
      const expectedCash = computeRemitCashAmount(openLegs, kind);
      const result = await remitRpc(admin, kind);

      if (result.error) throw new Error(`${kind} returned error: ${result.error}`);
      if (r2(result.cashAmount) !== r2(expectedCash)) {
        throw new Error(
          `${kind} cash parity: RPC ${result.cashAmount} != JS ${expectedCash}`,
        );
      }
      if ((result.legsCleared ?? 0) !== openLegs.length) {
        throw new Error(`${kind} legsCleared mismatch`);
      }
      const receipt = buildRemitExpenseReceiptNo(kind, PERIOD);
      if (result.expenseReceiptNo !== receipt) {
        throw new Error(`${kind} receipt mismatch`);
      }

      const { count: openAfter } = await admin
        .from("tax_ledger_entries")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", DAVORS)
        .eq("period_month", PERIOD)
        .eq("status", "open")
        .like("notes", `${STAMP}%`)
        .in(
          "tax_component",
          kind === "ssnit"
            ? ["ssnit_employee", "ssnit_employer_tier1", "ssnit_tier2"]
            : kind === "paye"
              ? ["paye"]
              : kind === "vat"
                ? ["vat_bundle", "vfrs"]
                : ["wht"],
        );

      if ((openAfter ?? 0) > 0) {
        throw new Error(`${kind} still has open legs after remit`);
      }

      results.push(`PASS remit ${kind} + parity`);
    }

    const essnit = await admin
      .from("expense_register")
      .select("payment_status")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", `PAYROLL-ESSNIT-${PERIOD_KEY}`)
      .maybeSingle();
    if (!essnit.data?.payment_status?.includes("Settled")) {
      throw new Error("SSNIT remit did not settle ESSNIT expense");
    }
    results.push("PASS SSNIT ESSNIT alignment");

    await cleanup(admin, pgClient);
    await seedPeriod(admin);

    await pgClient.query(
      `UPDATE tax_ledger_entries SET notes = $1 WHERE tenant_id = $2 AND notes = $3`,
      [`${STAMP}-ATOMIC-BLOCK`, DAVORS, STAMP],
    );

    await installAtomicityTrigger(pgClient);
    const beforeExpenses = (
      await pgClient.query(
        `SELECT count(*)::int AS cnt FROM expense_register WHERE tenant_id = $1 AND receipt_no LIKE $2`,
        [DAVORS, `TAX-REMIT-%-${PERIOD_KEY}`],
      )
    ).rows[0].cnt;

    const { error: failError } = await admin.rpc("remit_tax_for_period", {
      p_tenant_id: DAVORS,
      p_business_unit_id: null,
      p_period_month: PERIOD,
      p_kind: "paye",
      p_view_all_business_units: false,
    });
    await removeAtomicityTrigger(pgClient);

    if (!failError || !/TEST_ATOMICITY_BLOCK/i.test(failError.message)) {
      throw new Error(`Expected atomicity block, got: ${failError?.message ?? "none"}`);
    }

    const afterExpenses = (
      await pgClient.query(
        `SELECT count(*)::int AS cnt FROM expense_register WHERE tenant_id = $1 AND receipt_no LIKE $2`,
        [DAVORS, `TAX-REMIT-%-${PERIOD_KEY}`],
      )
    ).rows[0].cnt;
    const openPaye = (
      await pgClient.query(
        `SELECT count(*)::int AS cnt FROM tax_ledger_entries WHERE tenant_id = $1 AND period_month = $2 AND tax_component = 'paye' AND status = 'open'`,
        [DAVORS, PERIOD],
      )
    ).rows[0].cnt;

    if (afterExpenses !== beforeExpenses) {
      throw new Error("Atomicity fail: remittance expense committed");
    }
    if (openPaye < 1) {
      throw new Error("Atomicity fail: paye legs cleared despite block");
    }
    results.push("PASS atomicity full rollback");

    await cleanup(admin, pgClient);
    await seedPeriod(admin);
    await remitRpc(admin, "paye");

    const undo1 = await undoRpc(admin, "paye");
    if (undo1.error) throw new Error(`undo paye: ${undo1.error}`);
    if (!undo1.expenseDeleted) throw new Error("undo paye expense not deleted");
    if ((undo1.legsReopened ?? 0) < 1) throw new Error("undo paye legs not reopened");
    results.push("PASS undo paye");

    const undo2 = await undoRpc(admin, "paye");
    if (undo2.error) throw new Error(`double undo error: ${undo2.error}`);
    if (!undo2.message?.includes("No Paid")) {
      throw new Error(`double undo expected info message, got: ${undo2.message}`);
    }
    results.push("PASS undo idempotent second call");

    await cleanup(admin, pgClient);

    await pgClient.query(
      `INSERT INTO tax_ledger_entries (tenant_id, entry_date, period_month, direction, tax_component, tax_amount, taxable_base, status, source_type, counterparty_name, notes)
       VALUES ($1, '2099-08-31', $2, 'statutory_payable', 'ssnit_employer_tier1', 80, 800, 'open', 'manual', 'SSNIT', $3),
              ($1, '2099-08-31', $2, 'statutory_payable', 'ssnit_tier2', 25, 250, 'open', 'manual', 'SSNIT', $3),
              ($1, '2099-08-31', $2, 'statutory_payable', 'ssnit_employee', 120, 1200, 'open', 'manual', 'SSNIT', $3)`,
      [DAVORS, PERIOD, `${STAMP}-MARK-PAID`],
    );
    await admin.from("expense_register").insert({
      tenant_id: DAVORS,
      date: "2099-08-31",
      expense_category: "Employer SSNIT Contribution",
      sub_category: "Payroll",
      description: "Mark-as-Paid ESSNIT",
      vendor: "SSNIT",
      price: 105,
      quantity: 1,
      amount: 105,
      payment_method: "Bank Transfer",
      approved_by: "System",
      receipt_no: `PAYROLL-ESSNIT-${PERIOD_KEY}`,
      payment_status: "Paid",
      notes: `${STAMP}-MARK-PAID`,
    });

    const markPaidRemit = await remitRpc(admin, "ssnit");
    if (markPaidRemit.error) throw new Error(markPaidRemit.error);
    if (r2(markPaidRemit.cashAmount) !== r2(AMOUNTS.ssnit_employee)) {
      throw new Error(
        `Mark-as-Paid cash expected ${AMOUNTS.ssnit_employee}, got ${markPaidRemit.cashAmount}`,
      );
    }
    results.push("PASS SSNIT Mark-as-Paid coordination");

    await cleanup(admin, pgClient);

    await pgClient.query(
      `INSERT INTO tax_ledger_entries (tenant_id, entry_date, period_month, direction, tax_component, tax_amount, taxable_base, status, source_type, counterparty_name, notes)
       VALUES ($1, '2099-08-31', $2, 'statutory_payable', 'ssnit_employer_tier1', 80, 800, 'open', 'manual', 'SSNIT', $3),
              ($1, '2099-08-31', $2, 'statutory_payable', 'ssnit_tier2', 25, 250, 'open', 'manual', 'SSNIT', $3)`,
      [DAVORS, PERIOD, `${STAMP}-ZERO-CASH`],
    );
    await admin.from("expense_register").insert({
      tenant_id: DAVORS,
      date: "2099-08-31",
      expense_category: "Employer SSNIT Contribution",
      sub_category: "Payroll",
      description: "Mark-as-Paid ESSNIT zero-cash path",
      vendor: "SSNIT",
      price: 105,
      quantity: 1,
      amount: 105,
      payment_method: "Bank Transfer",
      approved_by: "System",
      receipt_no: `PAYROLL-ESSNIT-${PERIOD_KEY}`,
      payment_status: "Paid",
      notes: `${STAMP}-ZERO-CASH`,
    });

    const zeroCashRemit = await remitRpc(admin, "ssnit");
    if (zeroCashRemit.error) throw new Error(zeroCashRemit.error);
    if (r2(zeroCashRemit.cashAmount) !== 0) {
      throw new Error(`Zero-cash expected 0, got ${zeroCashRemit.cashAmount}`);
    }
    if (zeroCashRemit.expenseInserted) {
      throw new Error("Zero-cash path should not insert TAX-REMIT expense");
    }
    if ((zeroCashRemit.legsCleared ?? 0) !== 2) {
      throw new Error(`Zero-cash expected 2 legs cleared, got ${zeroCashRemit.legsCleared}`);
    }
    const { count: remitExpenseCount } = await admin
      .from("expense_register")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .like("receipt_no", `TAX-REMIT-SSNIT-${PERIOD_KEY}`);
    if ((remitExpenseCount ?? 0) > 0) {
      throw new Error("Zero-cash path should leave no TAX-REMIT expense row");
    }
    results.push("PASS SSNIT zero-cash employer-only path");

    console.log("\n=== RESULTS ===");
    for (const r of results) console.log(r);
    console.log(`\n${results.length}/${results.length} PASS`);
  } finally {
    await removeAtomicityTrigger(pgClient).catch(() => {});
    await cleanup(admin, pgClient).catch(() => {});
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
