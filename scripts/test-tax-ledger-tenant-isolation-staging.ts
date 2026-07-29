/**
 * Staging: verify tax SA RLS tenant isolation (script 128) + BS loader filter.
 *
 * Usage: npx tsx scripts/test-tax-ledger-tenant-isolation-staging.ts
 *
 * Creates temporary super_admin users on Davors + Caanta, seeds one tax_ledger
 * row each, asserts each SA only sees own-tenant tax_* rows (direct query and
 * Balance Sheet–shaped query). Cleans up rows + auth users.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "TaxRls-Iso-7Kx9!";
const stamp = Date.now().toString(36);
const davorsEmail = `tax.iso.davors.${stamp}@test.davors`;
const caantaEmail = `tax.iso.caanta.${stamp}@test.davors`;

/** Mirrors balance-sheet-page-data tax query (defense-in-depth tenant filter). */
async function fetchBsTaxEntries(client: SupabaseClient, tenantId: string) {
  const { data, error } = await client
    .from("tax_ledger_entries")
    .select("entry_date, direction, tax_component, tax_amount, status")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .order("entry_date", { ascending: true });
  return { entries: data ?? [], error: error?.message ?? null };
}

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

type Cleanup = {
  authUids: string[];
  taxIds: string[];
  settingsTouched: string[];
  catalogIds: string[];
};

const cleanup: Cleanup = {
  authUids: [],
  taxIds: [],
  settingsTouched: [],
  catalogIds: [],
};

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
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(serviceKey && anon, "Missing staging keys");

  // Source defense-in-depth checks
  const bsSrc = readFileSync(
    resolve("app/dashboard/finance/balance-sheet-page-data.ts"),
    "utf8",
  );
  assert(
    /tax_ledger_entries[\s\S]*?\.eq\("tenant_id", tenantId\)/.test(bsSrc),
    "BS loader missing tax_ledger tenant_id filter",
  );
  const dashSrc = readFileSync(resolve("app/dashboard/page.tsx"), "utf8");
  assert(
    /tax_ledger_entries[\s\S]*?\.eq\("tenant_id", tenantId\)/.test(dashSrc),
    "Dashboard missing tax_ledger tenant_id filter",
  );
  const ledgerSrc = readFileSync(
    resolve("app/dashboard/finance/tax-ledger.tsx"),
    "utf8",
  );
  assert(
    /refreshEntries[\s\S]*?\.eq\("tenant_id", tenantId\)/.test(ledgerSrc),
    "Statutory Ledger refresh missing tenant_id filter",
  );
  console.log("PASS source: BS / dashboard / Statutory Ledger tenant filters");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    await createSuperAdmin(admin, DAVORS, davorsEmail);
    await createSuperAdmin(admin, CAANTA, caantaEmail);
    console.log("PASS created temporary Davors + Caanta super_admins");

    // Ensure tax_settings rows exist
    for (const tid of [DAVORS, CAANTA]) {
      const { error } = await admin
        .from("tax_settings")
        .upsert({ tenant_id: tid }, { onConflict: "tenant_id", ignoreDuplicates: true });
      assert(!error, error?.message ?? `tax_settings upsert ${tid}`);
      cleanup.settingsTouched.push(tid);
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
        tax_amount: 200,
        status: "open",
        source_type: "manual",
        notes: `iso-test-davors-${stamp}`,
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
        tax_amount: 100,
        status: "open",
        source_type: "manual",
        notes: `iso-test-caanta-${stamp}`,
      })
      .select("id")
      .single();
    assert(!cTaxErr && caantaTax, cTaxErr?.message ?? "Caanta tax insert failed");
    cleanup.taxIds.push(caantaTax.id);
    console.log("PASS seeded Davors + Caanta tax_ledger_entries");

    const { data: davorsCat, error: dCatErr } = await admin
      .from("tax_rate_catalog")
      .insert({
        tenant_id: DAVORS,
        tax_kind: "wht",
        code: `ISO_DAVORS_${stamp}`.slice(0, 40),
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
        code: `ISO_CAANTA_${stamp}`.slice(0, 40),
        label: "Isolation Caanta WHT",
        rate_pct: 5,
        is_active: true,
        sort_order: 999,
      })
      .select("id")
      .single();
    assert(!cCatErr && caantaCat, cCatErr?.message ?? "Caanta catalog insert failed");
    cleanup.catalogIds.push(caantaCat.id);
    console.log("PASS seeded tenant tax_rate_catalog overrides");

    // --- Caanta super_admin must NOT see Davors tax ---
    const caantaClient = await signInAs(url, anon, caantaEmail);

    // Defense-in-depth BS tax query (explicit tenant_id) — must work even if RLS still leaky
    const bsData = await fetchBsTaxEntries(caantaClient, CAANTA);
    assert(!bsData.error, `BS tax fetch error: ${bsData.error}`);
    const bsAmounts = new Set(bsData.entries.map((e) => Number(e.tax_amount)));
    assert(bsAmounts.has(100), "BS tax query missing Caanta tax amount 100");
    assert(
      !bsAmounts.has(200),
      "LEAK: BS tax query returned Davors tax amount 200 (tenant_id filter missing?)",
    );
    console.log("PASS BS-shaped .eq(tenant_id) query for Caanta (defense-in-depth)");

    const { data: caantaLedger, error: caantaLedgerErr } = await caantaClient
      .from("tax_ledger_entries")
      .select("id, tenant_id, tax_amount, notes");
    assert(!caantaLedgerErr, caantaLedgerErr?.message ?? "Caanta ledger read failed");
    const caantaLedgerIds = new Set((caantaLedger ?? []).map((r) => r.id));
    assert(caantaLedgerIds.has(caantaTax.id), "Caanta SA cannot see own tax row");
    assert(
      !caantaLedgerIds.has(davorsTax.id),
      "LEAK: Caanta SA saw Davors tax_ledger_entries row — apply scripts/128_tax_ledger_super_admin_tenant_scope_rls.sql on staging first",
    );
    assert(
      (caantaLedger ?? []).every((r) => r.tenant_id === CAANTA),
      "LEAK: Caanta SA saw non-Caanta tenant_id on tax_ledger",
    );
    console.log(
      `PASS Caanta SA direct tax_ledger: ${caantaLedger?.length ?? 0} own-tenant row(s), no Davors`,
    );

    const { data: caantaSettings, error: caantaSetErr } = await caantaClient
      .from("tax_settings")
      .select("tenant_id");
    assert(!caantaSetErr, caantaSetErr?.message ?? "Caanta tax_settings read failed");
    assert(
      (caantaSettings ?? []).every((r) => r.tenant_id === CAANTA),
      "LEAK: Caanta SA saw other tax_settings",
    );
    assert(
      (caantaSettings ?? []).some((r) => r.tenant_id === CAANTA),
      "Caanta SA cannot see own tax_settings",
    );
    console.log("PASS Caanta SA tax_settings scoped");

    const { data: caantaCatalog, error: caantaCatReadErr } = await caantaClient
      .from("tax_rate_catalog")
      .select("id, tenant_id, code");
    assert(
      !caantaCatReadErr,
      caantaCatReadErr?.message ?? "Caanta catalog read failed",
    );
    const catIds = new Set((caantaCatalog ?? []).map((r) => r.id));
    assert(catIds.has(caantaCat.id), "Caanta SA cannot see own catalog override");
    assert(
      !catIds.has(davorsCat.id),
      "LEAK: Caanta SA saw Davors tax_rate_catalog override",
    );
    assert(
      (caantaCatalog ?? []).every(
        (r) => r.tenant_id === CAANTA || r.tenant_id == null,
      ),
      "LEAK: Caanta SA saw another tenant's catalog row",
    );
    console.log("PASS Caanta SA tax_rate_catalog scoped (own + system NULL ok)");

    // Balance Sheet–shaped query without app filter (RLS-only path)
    const { data: caantaBsTax, error: caantaBsErr } = await caantaClient
      .from("tax_ledger_entries")
      .select("entry_date, direction, tax_component, tax_amount, status, tenant_id")
      .eq("status", "open");
    assert(!caantaBsErr, caantaBsErr?.message ?? "Caanta BS-shaped tax query failed");
    assert(
      (caantaBsTax ?? []).every((r) => r.tenant_id === CAANTA),
      "LEAK: Caanta BS-shaped open tax query returned foreign tenant",
    );
    assert(
      !(caantaBsTax ?? []).some((r) => Number(r.tax_amount) === 200),
      "LEAK: Caanta open tax includes Davors 200 amount",
    );
    console.log("PASS Caanta SA BS-shaped open tax query is tenant-scoped");
    // --- Davors super_admin still sees own data, not Caanta ---
    const davorsClient = await signInAs(url, anon, davorsEmail);

    const { data: davorsLedger, error: davorsLedgerErr } = await davorsClient
      .from("tax_ledger_entries")
      .select("id, tenant_id, tax_amount");
    assert(!davorsLedgerErr, davorsLedgerErr?.message ?? "Davors ledger read failed");
    const davorsIds = new Set((davorsLedger ?? []).map((r) => r.id));
    assert(davorsIds.has(davorsTax.id), "Davors SA cannot see own tax row");
    assert(
      !davorsIds.has(caantaTax.id),
      "LEAK: Davors SA saw Caanta tax_ledger_entries",
    );
    assert(
      (davorsLedger ?? []).every((r) => r.tenant_id === DAVORS),
      "LEAK: Davors SA saw non-Davors tax_ledger",
    );
    console.log(
      `PASS Davors SA direct tax_ledger: ${davorsLedger?.length ?? 0} own-tenant row(s), no Caanta`,
    );

    const davorsBs = await fetchBsTaxEntries(davorsClient, DAVORS);
    assert(!davorsBs.error, `Davors BS tax fetch error: ${davorsBs.error}`);
    const davorsBsAmounts = new Set(
      davorsBs.entries.map((e) => Number(e.tax_amount)),
    );
    assert(davorsBsAmounts.has(200), "Davors BS missing own tax amount 200");
    assert(!davorsBsAmounts.has(100), "LEAK: Davors BS returned Caanta tax 100");
    console.log("PASS BS-shaped .eq(tenant_id) query for Davors");

    // Statutory Ledger pattern (explicit tenant filter) still works
    const { data: statutory, error: statutoryErr } = await davorsClient
      .from("tax_ledger_entries")
      .select("id, tenant_id")
      .eq("tenant_id", DAVORS)
      .order("entry_date", { ascending: false });
    assert(!statutoryErr, statutoryErr?.message ?? "Statutory-shaped query failed");
    assert(
      (statutory ?? []).some((r) => r.id === davorsTax.id),
      "Statutory-shaped query missing Davors seed row",
    );
    assert(
      (statutory ?? []).every((r) => r.tenant_id === DAVORS),
      "Statutory-shaped query returned foreign tenant",
    );
    console.log("PASS Statutory Ledger–shaped .eq(tenant_id) query unaffected");

    console.log("\nALL PASS — tax SA RLS isolation + BS defense-in-depth");
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
