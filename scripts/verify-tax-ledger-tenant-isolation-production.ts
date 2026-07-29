/**
 * PRODUCTION verification: tax SA RLS (script 128) + BS tax scoping.
 *
 * Usage: npx tsx scripts/verify-tax-ledger-tenant-isolation-production.ts
 *
 * Creates temporary super_admins, seeds one tax row each, asserts isolation,
 * reports real open-tax BS figures for Caanta + Davors, cleans up.
 * Does NOT modify production policies or permanent data beyond temp rows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821"; // production Caanta Market
const PASSWORD = "TaxRls-ProdVerify-7Kx9!";
const stamp = Date.now().toString(36);
const davorsEmail = `tax.iso.davors.${stamp}@test.davors`;
const caantaEmail = `tax.iso.caanta.${stamp}@test.davors`;

type TaxRow = {
  direction: string;
  tax_component: string;
  tax_amount: number;
  status: string;
  tenant_id?: string;
  id?: string;
};

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function summarizeOpenTax(rows: TaxRow[]) {
  const s = {
    whtReceivable: 0,
    outputTotal: 0,
    inputTax: 0,
    payePayable: 0,
    ssnitPayable: 0,
    netVat: 0,
  };
  for (const e of rows) {
    if (String(e.status).toLowerCase() !== "open") continue;
    const amount = Number(e.tax_amount) || 0;
    switch (e.direction) {
      case "wht_receivable":
        s.whtReceivable += amount;
        break;
      case "output":
        s.outputTotal += amount;
        break;
      case "input":
        s.inputTax += amount;
        break;
      case "statutory_payable":
        if (e.tax_component === "paye") s.payePayable += amount;
        else if (
          e.tax_component === "ssnit_employee" ||
          e.tax_component === "ssnit_employer_tier1" ||
          e.tax_component === "ssnit_tier2"
        ) {
          s.ssnitPayable += amount;
        }
        break;
    }
  }
  for (const k of Object.keys(s) as (keyof typeof s)[]) {
    s[k] = round2(s[k]);
  }
  s.netVat = round2(s.outputTotal - s.inputTax);
  return s;
}

async function fetchBsTaxEntries(client: SupabaseClient, tenantId: string) {
  const { data, error } = await client
    .from("tax_ledger_entries")
    .select("entry_date, direction, tax_component, tax_amount, status")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .order("entry_date", { ascending: true });
  return { entries: (data as TaxRow[] | null) ?? [], error: error?.message ?? null };
}

type Cleanup = { authUids: string[]; taxIds: string[]; catalogIds: string[] };
const cleanup: Cleanup = { authUids: [], taxIds: [], catalogIds: [] };

async function createSuperAdmin(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
) {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!authError && authData.user, authError?.message ?? "auth create failed");
  const authUid = authData.user!.id;
  cleanup.authUids.push(authUid);

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    role: "super_admin",
    is_active: true,
    tenant_id: tenantId,
  });
  assert(!insertError, insertError?.message ?? "user_accounts insert failed");
  return authUid;
}

async function signInAs(url: string, anon: string, email: string) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  assert(!error, error?.message ?? `sign-in failed for ${email}`);
  return client;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  assert(url.includes("tvcurcnmasnocwdxzgvz"), "Refusing non-production");
  assert(serviceKey && anon, "Missing production keys");
  console.log("Project:", new URL(url).hostname);
  console.log("Mode: PRODUCTION verify (temp users + cleanup)\n");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // --- Real open-tax figures BEFORE seeding (service role, tenant-filtered) ---
  const { data: caantaReal } = await admin
    .from("tax_ledger_entries")
    .select("direction, tax_component, tax_amount, status, tenant_id")
    .eq("tenant_id", CAANTA)
    .eq("status", "open");
  const { data: davorsReal } = await admin
    .from("tax_ledger_entries")
    .select("direction, tax_component, tax_amount, status, tenant_id")
    .eq("tenant_id", DAVORS)
    .eq("status", "open");

  const caantaSum = summarizeOpenTax((caantaReal as TaxRow[]) ?? []);
  const davorsSum = summarizeOpenTax((davorsReal as TaxRow[]) ?? []);
  console.log("=== REAL OPEN TAX (service-role, pre-seed) ===");
  console.log("Caanta:", caantaSum, `rows=${caantaReal?.length ?? 0}`);
  console.log("Davors:", davorsSum, `rows=${davorsReal?.length ?? 0}`);

  assert(
    caantaSum.netVat !== 9002.31 &&
      caantaSum.whtReceivable !== 2353.55 &&
      !(
        caantaSum.netVat === 9002.31 ||
        caantaSum.whtReceivable === 2353.55 ||
        caantaSum.payePayable === 1147.95 ||
        caantaSum.ssnitPayable === 1454.35
      ),
    "Caanta stored open tax still matches Davors leak figures",
  );
  assert(
    Math.abs(davorsSum.netVat - 9002.31) < 0.02 || davorsSum.netVat > 0,
    "Davors open tax unexpectedly empty",
  );
  console.log(
    "PASS Caanta stored tax is NOT the old Davors leak totals; Davors still has real open tax\n",
  );

  try {
    await createSuperAdmin(admin, DAVORS, davorsEmail);
    await createSuperAdmin(admin, CAANTA, caantaEmail);
    console.log("PASS created temporary Davors + Caanta super_admins");

    for (const tid of [DAVORS, CAANTA]) {
      const { error } = await admin
        .from("tax_settings")
        .upsert({ tenant_id: tid }, { onConflict: "tenant_id", ignoreDuplicates: true });
      assert(!error, error?.message ?? `tax_settings upsert ${tid}`);
    }

    const periodMonth = "2026-07-01";
    const entryDate = "2026-07-15";

    const { data: davorsTax, error: dTaxErr } = await admin
      .from("tax_ledger_entries")
      .insert({
        tenant_id: DAVORS,
        entry_date: entryDate,
        period_month: periodMonth,
        direction: "output",
        tax_component: "vat_bundle",
        rate_pct: 20,
        taxable_base: 1000,
        tax_amount: 200.11,
        status: "open",
        source_type: "manual",
        notes: `iso-prod-davors-${stamp}`,
      })
      .select("id")
      .single();
    assert(!dTaxErr && davorsTax, dTaxErr?.message ?? "Davors tax insert failed");
    cleanup.taxIds.push(davorsTax.id);

    const { data: caantaTax, error: cTaxErr } = await admin
      .from("tax_ledger_entries")
      .insert({
        tenant_id: CAANTA,
        entry_date: entryDate,
        period_month: periodMonth,
        direction: "output",
        tax_component: "vat_bundle",
        rate_pct: 20,
        taxable_base: 500,
        tax_amount: 100.22,
        status: "open",
        source_type: "manual",
        notes: `iso-prod-caanta-${stamp}`,
      })
      .select("id")
      .single();
    assert(!cTaxErr && caantaTax, cTaxErr?.message ?? "Caanta tax insert failed");
    cleanup.taxIds.push(caantaTax.id);
    console.log("PASS seeded temp Davors + Caanta tax_ledger_entries");

    const { data: davorsCat, error: dCatErr } = await admin
      .from("tax_rate_catalog")
      .insert({
        tenant_id: DAVORS,
        tax_kind: "wht",
        code: `ISO_PD_${stamp}`.slice(0, 40),
        label: "Isolation Davors WHT",
        rate_pct: 7.5,
        is_active: true,
        sort_order: 999,
      })
      .select("id")
      .single();
    assert(!dCatErr && davorsCat, dCatErr?.message ?? "Davors catalog insert failed");
    cleanup.catalogIds.push(davorsCat.id);

    const { data: caantaCat, error: cCatErr } = await admin
      .from("tax_rate_catalog")
      .insert({
        tenant_id: CAANTA,
        tax_kind: "wht",
        code: `ISO_PC_${stamp}`.slice(0, 40),
        label: "Isolation Caanta WHT",
        rate_pct: 5,
        is_active: true,
        sort_order: 999,
      })
      .select("id")
      .single();
    assert(!cCatErr && caantaCat, cCatErr?.message ?? "Caanta catalog insert failed");
    cleanup.catalogIds.push(caantaCat.id);

    // --- 1. Caanta SA isolation ---
    const caantaClient = await signInAs(url, anon, caantaEmail);

    const bsCaanta = await fetchBsTaxEntries(caantaClient, CAANTA);
    assert(!bsCaanta.error, `Caanta BS tax: ${bsCaanta.error}`);
    const caantaBsAmts = new Set(bsCaanta.entries.map((e) => Number(e.tax_amount)));
    assert(caantaBsAmts.has(100.22), "Caanta BS missing own seed 100.22");
    assert(!caantaBsAmts.has(200.11), "LEAK: Caanta BS includes Davors seed 200.11");
    console.log("PASS (3) Caanta BS-shaped .eq(tenant_id) has no Davors figures");

    const { data: caantaLedger, error: caantaLedgerErr } = await caantaClient
      .from("tax_ledger_entries")
      .select("id, tenant_id, tax_amount");
    assert(!caantaLedgerErr, caantaLedgerErr?.message ?? "Caanta ledger read failed");
    const caantaIds = new Set((caantaLedger ?? []).map((r) => r.id));
    assert(caantaIds.has(caantaTax.id), "Caanta SA cannot see own tax row");
    assert(!caantaIds.has(davorsTax.id), "LEAK: Caanta SA saw Davors tax row");
    assert(
      (caantaLedger ?? []).every((r) => r.tenant_id === CAANTA),
      "LEAK: Caanta SA saw foreign tenant_id on tax_ledger",
    );
    console.log(
      `PASS (1) Caanta SA tax_ledger: ${caantaLedger?.length ?? 0} own-tenant row(s), no Davors`,
    );

    const { data: caantaSettings, error: caantaSetErr } = await caantaClient
      .from("tax_settings")
      .select("tenant_id");
    assert(!caantaSetErr, caantaSetErr?.message ?? "Caanta tax_settings failed");
    assert(
      (caantaSettings ?? []).every((r) => r.tenant_id === CAANTA),
      "LEAK: Caanta SA saw other tax_settings",
    );
    console.log("PASS (1) Caanta SA tax_settings scoped");

    const { data: caantaCatalog, error: caantaCatReadErr } = await caantaClient
      .from("tax_rate_catalog")
      .select("id, tenant_id");
    assert(!caantaCatReadErr, caantaCatReadErr?.message ?? "Caanta catalog failed");
    const catIds = new Set((caantaCatalog ?? []).map((r) => r.id));
    assert(catIds.has(caantaCat.id), "Caanta SA cannot see own catalog override");
    assert(!catIds.has(davorsCat.id), "LEAK: Caanta SA saw Davors catalog");
    assert(
      (caantaCatalog ?? []).every(
        (r) => r.tenant_id === CAANTA || r.tenant_id == null,
      ),
      "LEAK: Caanta SA saw another tenant catalog row",
    );
    console.log("PASS (1) Caanta SA tax_rate_catalog scoped");

    // Unfiltered open tax as Caanta SA must not include Davors leak totals
    const { data: caantaOpenAll, error: caantaOpenErr } = await caantaClient
      .from("tax_ledger_entries")
      .select("direction, tax_component, tax_amount, status, tenant_id")
      .eq("status", "open");
    assert(!caantaOpenErr, caantaOpenErr?.message ?? "Caanta open tax failed");
    assert(
      (caantaOpenAll ?? []).every((r) => r.tenant_id === CAANTA),
      "LEAK: Caanta unfiltered open tax includes foreign tenant",
    );
    const caantaOpenSum = summarizeOpenTax((caantaOpenAll as TaxRow[]) ?? []);
    assert(
      Math.abs(caantaOpenSum.netVat - 9002.31) > 0.02,
      "LEAK: Caanta open Net VAT still ~9002.31",
    );
    assert(
      Math.abs(caantaOpenSum.whtReceivable - 2353.55) > 0.02,
      "LEAK: Caanta open WHT still ~2353.55",
    );
    console.log("PASS (3) Caanta SA open-tax summary (no Davors leak totals):", caantaOpenSum);

    // --- 2. Davors SA ---
    const davorsClient = await signInAs(url, anon, davorsEmail);

    const { data: davorsLedger, error: davorsLedgerErr } = await davorsClient
      .from("tax_ledger_entries")
      .select("id, tenant_id, tax_amount");
    assert(!davorsLedgerErr, davorsLedgerErr?.message ?? "Davors ledger failed");
    const davorsIds = new Set((davorsLedger ?? []).map((r) => r.id));
    assert(davorsIds.has(davorsTax.id), "Davors SA cannot see own seed tax");
    assert(!davorsIds.has(caantaTax.id), "LEAK: Davors SA saw Caanta tax");
    assert(
      (davorsLedger ?? []).every((r) => r.tenant_id === DAVORS),
      "LEAK: Davors SA saw foreign tenant_id",
    );
    console.log(
      `PASS (2) Davors SA tax_ledger: ${davorsLedger?.length ?? 0} own-tenant row(s), no Caanta`,
    );

    const davorsBs = await fetchBsTaxEntries(davorsClient, DAVORS);
    assert(!davorsBs.error, `Davors BS tax: ${davorsBs.error}`);
    const davorsBsAmts = new Set(davorsBs.entries.map((e) => Number(e.tax_amount)));
    assert(davorsBsAmts.has(200.11), "Davors BS missing own seed 200.11");
    assert(!davorsBsAmts.has(100.22), "LEAK: Davors BS includes Caanta seed");
    console.log("PASS (2)/(3) Davors BS-shaped query own-only");

    // --- 4. Statutory Ledger pattern ---
    for (const [label, client, tid, ownId, otherId] of [
      ["Caanta", caantaClient, CAANTA, caantaTax.id, davorsTax.id],
      ["Davors", davorsClient, DAVORS, davorsTax.id, caantaTax.id],
    ] as const) {
      const { data, error } = await client
        .from("tax_ledger_entries")
        .select("id, tenant_id")
        .eq("tenant_id", tid)
        .order("entry_date", { ascending: false });
      assert(!error, `${label} statutory: ${error?.message}`);
      const ids = new Set((data ?? []).map((r) => r.id));
      assert(ids.has(ownId), `${label} statutory missing own seed`);
      assert(!ids.has(otherId), `${label} statutory includes other tenant seed`);
      assert(
        (data ?? []).every((r) => r.tenant_id === tid),
        `${label} statutory foreign tenant`,
      );
      console.log(`PASS (4) Statutory Ledger–shaped query OK for ${label}`);
    }

    // Davors real figures still present (excluding our seed via amount check on pre-seed snapshot)
    console.log("\n=== DAVORS PRE-SEED OPEN TAX (should be unchanged by RLS fix) ===");
    console.log(davorsSum);
    assert(
      Math.abs(davorsSum.netVat - 9002.31) < 0.05,
      `Davors Net VAT unexpected: ${davorsSum.netVat} (expected ~9002.31)`,
    );
    assert(
      Math.abs(davorsSum.whtReceivable - 2353.55) < 0.05,
      `Davors WHT unexpected: ${davorsSum.whtReceivable}`,
    );
    assert(
      Math.abs(davorsSum.payePayable - 1147.95) < 0.05,
      `Davors PAYE unexpected: ${davorsSum.payePayable}`,
    );
    assert(
      Math.abs(davorsSum.ssnitPayable - 1454.35) < 0.05,
      `Davors SSNIT unexpected: ${davorsSum.ssnitPayable}`,
    );
    console.log("PASS Davors open tax totals unchanged (~9002.31 / 2353.55 / 1147.95 / 1454.35)");

    console.log("\n=== CAANTA PRE-SEED OPEN TAX (should be tiny / zero) ===");
    console.log(caantaSum);
    assert(caantaSum.netVat === 0, `Caanta Net VAT should be 0, got ${caantaSum.netVat}`);
    assert(
      caantaSum.whtReceivable === 0,
      `Caanta WHT should be 0, got ${caantaSum.whtReceivable}`,
    );
    assert(caantaSum.payePayable === 0, `Caanta PAYE should be 0, got ${caantaSum.payePayable}`);
    assert(
      caantaSum.ssnitPayable === 0,
      `Caanta SSNIT should be 0, got ${caantaSum.ssnitPayable}`,
    );
    console.log("PASS Caanta open tax all zero (tiny books; no leaked Davors figures)");

    console.log("\nALL PASS — production tax SA RLS isolation verified");
  } finally {
    for (const id of cleanup.taxIds) {
      await admin.from("tax_ledger_entries").delete().eq("id", id);
    }
    for (const id of cleanup.catalogIds) {
      await admin.from("tax_rate_catalog").delete().eq("id", id);
    }
    for (const authUid of cleanup.authUids) {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    }
    console.log("Cleanup done");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
