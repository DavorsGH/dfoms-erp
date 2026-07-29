/**
 * Staging: apply scripts/126_income_register_system_adjustment.sql then verify
 * non-cash system adjustments stay untaxed / AR=0, while normal invoices still
 * get VAT/WHT + outstanding via the Income Register tax path.
 *
 *   npx tsx scripts/test-system-adjustment-income-staging.ts --env-file .env.staging.local
 *
 * Requires DATABASE_URL or SUPABASE_DB_PASSWORD for DDL apply.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  computeOutputTax,
  computeWhtAmount,
  resolveDefaultWhtRate,
} from "../app/dashboard/finance/tax-utils";
import { syncIncomeRegisterTaxLedger } from "../app/dashboard/finance/tax-ledger-sync";
import { calculateIncomeOutstanding } from "../app/dashboard/finance/income-register-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath) {
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function almost(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function candidates(projectRef, password) {
  const enc = encodeURIComponent(password);
  return [
    process.env.DATABASE_URL,
    `postgresql://postgres.${projectRef}:${enc}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:${enc}@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true`,
    `postgresql://postgres:${enc}@db.${projectRef}.supabase.co:5432/postgres`,
  ].filter(Boolean);
}

async function applyMigration(projectRef) {
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "";
  const sql = readFileSync(
    resolve("scripts/126_income_register_system_adjustment.sql"),
    "utf8",
  );
  let lastErr = null;
  for (const url of candidates(projectRef, password)) {
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      await client.query(sql);
      await client.end();
      console.log("Applied 126 via", url.replace(/:[^:@]+@/, ":***@"));
      return;
    } catch (err) {
      lastErr = err;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error(`Failed to apply 126: ${lastErr?.message ?? lastErr}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const envIdx = argv.indexOf("--env-file");
  const envFile =
    envIdx >= 0 && argv[envIdx + 1] ? argv[envIdx + 1] : ".env.staging.local";
  loadEnvForce(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging: ${url}`);
  assert(key, "Missing service role key");

  const admin = createClient(url, key, { auth: { persistSession: false } });

  console.log("=== Apply migration 126 on staging (skip if column exists) ===");
  {
    const { error: colErr } = await admin
      .from("income_register")
      .select("is_system_adjustment")
      .limit(0);
    if (!colErr) {
      console.log("is_system_adjustment already present ? skipping DDL");
    } else {
      console.log(
        "column missing (" + (colErr.message || colErr.code) + ") ? applying 126",
      );
      await applyMigration(STAGING_REF);
    }
  }

  // Load tax settings for the "UI reshape" simulation
  const { data: taxSettings } = await admin
    .from("tax_settings")
    .select("*")
    .eq("tenant_id", DAVORS)
    .maybeSingle();

  const stamp = Date.now();
  const sysInvoice = `PAYROLL-DEDSAV-TEST-${stamp}`;
  const normalInvoice = `INV-TAX-REGRESSION-${stamp}`;

  console.log("\n=== A) Insert system-adjustment DEDSAV-shaped row ===");
  const sysPayload = {
    tenant_id: DAVORS,
    date: "2026-08-15",
    due_date: "2026-08-15",
    invoice_no: sysInvoice,
    customer_name: "Payroll",
    client_id: null,
    entry_type: "service",
    service_category: "Other Income",
    description: "Staging test system non-cash adjustment",
    amount: 100,
    amount_received: 0,
    outstanding_balance: 0,
    payment_status: "Unpaid",
    notes: "test system adj",
    tax_inclusive: true,
    net_of_tax_amount: 100,
    output_vat_amount: 0,
    output_tax_component: null,
    wht_rate: null,
    wht_amount: 0,
    is_system_adjustment: true,
    sale_status: "active",
  };

  const { data: sysRow, error: sysInsErr } = await admin
    .from("income_register")
    .insert(sysPayload)
    .select("*")
    .single();
  assert(!sysInsErr && sysRow, sysInsErr?.message ?? "sys insert failed");
  console.log("inserted", {
    id: sysRow.id,
    outstanding: sysRow.outstanding_balance,
    vat: sysRow.output_vat_amount,
    wht: sysRow.wht_amount,
    flag: sysRow.is_system_adjustment,
  });
  assert(almost(sysRow.outstanding_balance, 0), "sys OB should be 0 after insert");
  assert(almost(sysRow.output_vat_amount, 0), "sys VAT should be 0");
  assert(almost(sysRow.wht_amount ?? 0, 0), "sys WHT should be 0");

  console.log("\n=== B) Simulate Income Register UI reshape on system row ===");
  // Mimic handleSubmit: compute tax + outstanding, then update + sync ledger
  const amount = 100;
  const outputTax = computeOutputTax({
    amount,
    entryType: "service",
    taxInclusive: true,
    settings: taxSettings,
  });
  const whtRate = resolveDefaultWhtRate(taxSettings);
  const whtAmount = computeWhtAmount(amount, whtRate);
  const outstanding = calculateIncomeOutstanding(amount, 0, whtAmount);

  const { data: afterUi, error: uiUpdErr } = await admin
    .from("income_register")
    .update({
      client_id: "CL-001",
      service_category: "Commercial Cleaning",
      amount,
      amount_received: 0,
      outstanding_balance: outstanding,
      tax_inclusive: true,
      net_of_tax_amount: outputTax.netOfTaxAmount,
      output_tax_component: outputTax.component,
      output_vat_amount: outputTax.outputVatAmount,
      wht_rate: whtRate,
      wht_amount: whtAmount,
      payment_status: "Pending",
      // keep flag true ? UI cannot clear it without knowing about it
      is_system_adjustment: true,
    })
    .eq("id", sysRow.id)
    .select("*")
    .single();
  assert(!uiUpdErr && afterUi, uiUpdErr?.message ?? "UI update failed");

  // Even if app tried to sync tax, trigger should clear ledger
  await syncIncomeRegisterTaxLedger(admin, {
    sourceId: sysRow.id,
    entryDate: "2026-08-15",
    amount,
    whtRatePct: whtRate,
    whtAmount,
    outputTaxComponent: outputTax.component,
    outputTaxRatePct: outputTax.component ? outputTax.ratePct : null,
    outputVatAmount: outputTax.outputVatAmount,
    counterpartyName: "Central University",
    notes: `Invoice ${sysInvoice}`,
    tenantId: DAVORS,
  });

  const { data: protectedRow } = await admin
    .from("income_register")
    .select("*")
    .eq("id", sysRow.id)
    .single();
  const { data: sysTax } = await admin
    .from("tax_ledger_entries")
    .select("*")
    .eq("source_type", "income_register")
    .eq("source_id", sysRow.id);

  console.log("after hostile UI reshape + tax sync:", {
    outstanding: protectedRow.outstanding_balance,
    vat: protectedRow.output_vat_amount,
    wht: protectedRow.wht_amount,
    net: protectedRow.net_of_tax_amount,
    taxRows: sysTax?.length ?? 0,
  });
  assert(
    almost(protectedRow.outstanding_balance, 0),
    "trigger must force outstanding_balance=0",
  );
  assert(
    almost(protectedRow.output_vat_amount, 0),
    "trigger must force output_vat_amount=0",
  );
  assert(almost(protectedRow.wht_amount ?? 0, 0), "trigger must force wht=0");
  assert(
    almost(protectedRow.net_of_tax_amount, 100),
    "trigger must keep net_of_tax = amount",
  );
  assert((sysTax ?? []).length === 0, "tax_ledger legs must be cleared");
  console.log("PASS system adjustment protected from UI tax/AR reshape");

  console.log("\n=== C) Normal invoice still gets tax + AR ===");
  const { data: normalRow, error: normalInsErr } = await admin
    .from("income_register")
    .insert({
      tenant_id: DAVORS,
      date: "2026-08-16",
      due_date: "2026-08-16",
      invoice_no: normalInvoice,
      client_id: "CL-001",
      customer_name: null,
      entry_type: "service",
      service_category: "Commercial Cleaning",
      description: "Staging tax regression invoice",
      amount: 120,
      amount_received: 0,
      outstanding_balance: calculateIncomeOutstanding(120, 0, 0),
      payment_status: "Pending",
      tax_inclusive: true,
      is_system_adjustment: false,
      sale_status: "active",
    })
    .select("*")
    .single();
  assert(!normalInsErr && normalRow, normalInsErr?.message ?? "normal insert failed");

  const normalOutput = computeOutputTax({
    amount: 120,
    entryType: "service",
    taxInclusive: true,
    settings: taxSettings,
  });
  const normalWhtRate = resolveDefaultWhtRate(taxSettings);
  const normalWht = computeWhtAmount(120, normalWhtRate);
  const normalOb = calculateIncomeOutstanding(120, 0, normalWht);

  const { data: normalSaved, error: normalUpdErr } = await admin
    .from("income_register")
    .update({
      outstanding_balance: normalOb,
      net_of_tax_amount: normalOutput.netOfTaxAmount,
      output_tax_component: normalOutput.component,
      output_vat_amount: normalOutput.outputVatAmount,
      wht_rate: normalWhtRate,
      wht_amount: normalWht,
    })
    .eq("id", normalRow.id)
    .select("*")
    .single();
  assert(!normalUpdErr && normalSaved, normalUpdErr?.message ?? "normal update failed");

  const { error: normalTaxErr } = await syncIncomeRegisterTaxLedger(admin, {
    sourceId: normalRow.id,
    entryDate: "2026-08-16",
    amount: 120,
    whtRatePct: normalWhtRate,
    whtAmount: normalWht,
    outputTaxComponent: normalOutput.component,
    outputTaxRatePct: normalOutput.component ? normalOutput.ratePct : null,
    outputVatAmount: normalOutput.outputVatAmount,
    counterpartyName: "Central University",
    notes: `Invoice ${normalInvoice}`,
    tenantId: DAVORS,
  });
  assert(!normalTaxErr, normalTaxErr ?? "normal tax sync failed");

  const { data: normalTax } = await admin
    .from("tax_ledger_entries")
    .select("*")
    .eq("source_type", "income_register")
    .eq("source_id", normalRow.id);

  console.log("normal invoice after tax path:", {
    outstanding: normalSaved.outstanding_balance,
    vat: normalSaved.output_vat_amount,
    wht: normalSaved.wht_amount,
    taxRows: normalTax?.length ?? 0,
  });
  assert(
    !almost(normalSaved.output_vat_amount, 0) ||
      taxSettings?.vat_registered === false,
    "normal invoice should receive output VAT when vat_registered",
  );
  assert(
    (normalTax?.length ?? 0) > 0 || taxSettings?.vat_registered === false,
    "normal invoice should have tax_ledger rows when vat_registered",
  );
  assert(
    almost(normalSaved.outstanding_balance, normalOb),
    "normal outstanding should reflect WHT reduction",
  );
  console.log("PASS normal invoice still taxed/AR-tracked");

  // Cleanup test rows
  await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("source_type", "income_register")
    .in("source_id", [sysRow.id, normalRow.id]);
  await admin.from("income_register").delete().in("id", [sysRow.id, normalRow.id]);
  console.log("\nCleaned up test rows");
  console.log("\nALL STAGING CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
