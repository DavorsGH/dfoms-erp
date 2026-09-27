// @ts-nocheck
/**
 * Compare save_accounts_payable / replacement RPC privileges on staging.
 * npx tsx scripts/probe-supplier-contract-function-privileges-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { computePurchaseTaxAmounts } from "../app/dashboard/finance/tax-utils";
import { buildPurchaseTaxLedgerRpcPayload } from "../app/dashboard/finance/tax-ledger-sync";
import { generateSupplierContractAccountsPayableCore } from "../utils/supplier-contract-ap-generation-core";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const EPHEMERAL_PASSWORD = "SpcPriv-Probe-9Kx!";

function loadEnv(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function deleteAccountsPayableViaRpc(admin, tenantId, apId) {
  const { error } = await admin.rpc("delete_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: apId,
  });
  if (error) throw new Error(error.message);
}

async function deleteAccountsPayableForContract(admin, tenantId, contractId) {
  const { data: aps } = await admin
    .from("accounts_payable")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_id", contractId);
  for (const row of aps ?? []) {
    await deleteAccountsPayableViaRpc(admin, tenantId, row.id);
  }
}

async function deleteAccountsPayableMatchingNotes(admin, tenantId, stamp) {
  const { data: aps } = await admin
    .from("accounts_payable")
    .select("id")
    .eq("tenant_id", tenantId)
    .like("notes", `%${stamp}%`);
  for (const row of aps ?? []) {
    await deleteAccountsPayableViaRpc(admin, tenantId, row.id);
  }
}

async function cleanupPrivilegeProbe(admin, tenantId, stamp, contractId, supplierId) {
  if (contractId) {
    await admin.from("supplier_contract_deductions").delete().eq("contract_id", contractId);
    await deleteAccountsPayableForContract(admin, tenantId, contractId);
    await admin.from("supplier_contract_amendments").delete().eq("contract_id", contractId);
    await admin.from("supplier_contracts").delete().eq("id", contractId);
  }
  if (supplierId) {
    await admin.from("suppliers").delete().eq("id", supplierId);
  }
  await admin.from("product_purchases").delete().like("notes", `%${stamp}%`);
  await deleteAccountsPayableMatchingNotes(admin, tenantId, stamp);
  await admin.from("expense_register").delete().like("notes", `%${stamp}%`);
}

async function fnMeta(pgClient, proname) {
  const { rows } = await pgClient.query(
    `
    SELECT
      p.oid::regprocedure AS signature,
      pg_get_userbyid(p.proowner)::text AS owner,
      p.prosecdef AS security_definer,
      p.proconfig AS config,
      pg_catalog.array_to_string(p.proacl, E',') AS acl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = $1
    ORDER BY 1
    `,
    [proname],
  );
  return rows;
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  if (ref !== STAGING_REF) throw new Error(`Not staging: ${ref}`);

  const pgClient = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  console.log("=== 2a) save_accounts_payable on staging (311) ===");
  console.log(JSON.stringify(await fnMeta(pgClient, "save_accounts_payable"), null, 2));
  console.log("\n282 reference (from repo file): SECURITY DEFINER, SET search_path=public, GRANT authenticated+service_role on 22-arg sig (311 uses 23-arg with p_source_id)");

  console.log("\n=== 2b) record_supplier_contract_replacement_payment ===");
  console.log(
    JSON.stringify(await fnMeta(pgClient, "record_supplier_contract_replacement_payment"), null, 2),
  );

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tenantId =
    process.env.STAGING_TEST_TENANT_ID ?? "00000001-0000-4000-8000-000000000001";
  const ephemeralEmail = `spc.priv.probe.${Date.now()}@test.davors`;
  const { data: authCreate, error: authCreateErr } = await admin.auth.admin.createUser({
    email: ephemeralEmail,
    password: EPHEMERAL_PASSWORD,
    email_confirm: true,
  });
  if (authCreateErr || !authCreate.user) {
    console.log("\n=== 2d) AUTH SKIP ===", authCreateErr?.message ?? "createUser failed");
    await pgClient.end();
    return;
  }
  const authUid = authCreate.user.id;
  const { error: uaErr } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email: ephemeralEmail,
    role: "finance",
    is_active: true,
    tenant_id: tenantId,
  });
  if (uaErr) {
    await admin.auth.admin.deleteUser(authUid);
    console.log("\n=== 2d) AUTH SKIP ===", uaErr.message);
    await pgClient.end();
    return;
  }

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signErr } = await authClient.auth.signInWithPassword({
    email: ephemeralEmail,
    password: EPHEMERAL_PASSWORD,
  });
  if (signErr) {
    console.log("\n=== 2d) AUTH SKIP ===", signErr.message);
    await pgClient.end();
    return;
  }

  console.log(
    `\n=== 2d) Authenticated ephemeral finance user ${ephemeralEmail} tenant=${tenantId} ===`,
  );

  const stamp = `SPC-AUTH-${Date.now()}`;
  const results = [];
  let probeContractId = null;
  let probeSupplierId = null;

  try {
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht: 400,
    whtRatePct: 0,
    whtAmount: 0,
    inputVatAmount: 0,
  });
  const taxRows = buildPurchaseTaxLedgerRpcPayload({
    sourceType: "accounts_payable",
    sourceId: stamp,
    entryDate: "2099-06-15",
    grossBeforeWht: 400,
    whtRatePct: null,
    whtAmount: 0,
    inputTaxComponent: null,
    inputVatAmount: 0,
    counterpartyName: stamp,
    notes: stamp,
  });

  const { data: apCreate, error: apCreateErr } = await authClient.rpc("save_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: null,
    p_business_unit_id: null,
    p_vendor_name: `${stamp} Vendor`,
    p_invoice_number: `${stamp}-INV`,
    p_expense_category: "Administrative",
    p_sub_category: "General",
    p_description: stamp,
    p_invoice_date: "2099-06-15",
    p_due_date: "2099-07-15",
    p_amount: purchaseTax.netOfTaxAmount,
    p_amount_paid: 0,
    p_balance_due: purchaseTax.netOfTaxAmount,
    p_status: "Outstanding",
    p_gross_before_wht: 400,
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: 400,
    p_notes: stamp,
    p_source_type: null,
    p_tax_rows: taxRows,
  });
  results.push([
    "AP create (authenticated)",
    !apCreateErr && apCreate?.id ? "PASS" : `FAIL ${apCreateErr?.message}`,
  ]);
  const apId = apCreate?.id;

  if (apId) {
    const { error: payErr } = await authClient.from("accounts_payable_payments").insert({
      tenant_id: tenantId,
      accounts_payable_id: apId,
      payment_date: "2099-06-20",
      amount: 100,
      payment_source: "company_cash",
      notes: stamp,
    });
    const { error: recalcErr } = await authClient.rpc("recompute_accounts_payable_from_payments", {
      p_ap_id: apId,
    });
    results.push([
      "AP payment (authenticated)",
      !payErr && !recalcErr ? "PASS" : `FAIL ${payErr?.message ?? recalcErr?.message}`,
    ]);

    const { error: editErr } = await authClient.rpc("save_accounts_payable", {
      p_tenant_id: tenantId,
      p_ap_id: apId,
      p_business_unit_id: null,
      p_vendor_name: `${stamp} Vendor`,
      p_invoice_number: `${stamp}-INV`,
      p_expense_category: "Administrative",
      p_sub_category: "General",
      p_description: `${stamp} edited`,
      p_invoice_date: "2099-06-15",
      p_due_date: "2099-07-15",
      p_amount: 400,
      p_amount_paid: 100,
      p_balance_due: 300,
      p_status: "Partially Paid",
      p_gross_before_wht: 400,
      p_wht_rate: null,
      p_wht_amount: 0,
      p_input_vat_amount: 0,
      p_net_of_tax_amount: 400,
      p_notes: stamp,
      p_source_type: null,
      p_tax_rows: taxRows,
    });
    results.push(["AP edit (authenticated)", !editErr ? "PASS" : `FAIL ${editErr.message}`]);

    const { error: delErr } = await authClient.rpc("delete_accounts_payable", {
      p_tenant_id: tenantId,
      p_ap_id: apId,
    });
    results.push(["AP delete (authenticated)", !delErr ? "PASS" : `FAIL ${delErr.message}`]);
  }

  const faId = `${stamp}-FA`;
  const { error: faErr } = await authClient.rpc("save_fixed_asset", {
    p_tenant_id: tenantId,
    p_asset_id: faId,
    p_is_update: false,
    p_business_unit_id: null,
    p_asset_name: `${stamp} Asset`,
    p_asset_category: "Equipment",
    p_purchase_date: "2099-06-15",
    p_original_cost: 900,
    p_quantity: 1,
    p_total_cost: 900,
    p_useful_life_years: 5,
    p_depreciation_method: "Straight-Line",
    p_annual_depreciation: 180,
    p_accumulated_depreciation: 0,
    p_net_book_value: 900,
    p_location: "HQ",
    p_notes: stamp,
    p_payment_method: "Supplier Credit",
    p_vendor_name: `${stamp} FA Vendor`,
    p_approved_by: "System",
    p_gross_before_wht: 900,
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: 900,
    p_existing_payable_id: null,
    p_tax_rows: [],
  });
  results.push(["FA on credit (authenticated)", !faErr ? "PASS" : `FAIL ${faErr.message}`]);
  if (!faErr) {
    await authClient.rpc("delete_fixed_asset", { p_tenant_id: tenantId, p_asset_id: faId });
  }

  const { data: product } = await admin
    .from("finished_products")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  const { data: supplier } = await admin
    .from("suppliers")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  if (product?.id && supplier?.id) {
    const { data: plotCode, error: plotErr } = await authClient.rpc("generate_next_code", {
      p_tenant_id: tenantId,
      p_entity_type: "PLOT",
      p_padding: 4,
    });
    const { error: purErr } = await authClient.rpc("create_product_purchase", {
      p_purchase_date: "2099-06-15",
      p_product_id: product.id,
      p_quantity: 1,
      p_cost_per_unit: 25,
      p_supplier_id: supplier.id,
      p_payment_method: "Supplier Credit",
      p_notes: stamp,
      p_batch_number: plotCode ?? `${stamp}-BATCH`,
      p_business_unit_id: null,
    });
    results.push([
      "Credit product purchase (authenticated)",
      !purErr && !plotErr ? "PASS" : `FAIL ${purErr?.message ?? plotErr?.message}`,
    ]);
  }

  const { data: supRow } = await admin
    .from("suppliers")
    .insert({ tenant_id: tenantId, name: `${stamp} SPC Supplier`, is_active: true })
    .select("id")
    .single();
  probeSupplierId = supRow?.id ?? null;
  const { data: contractNumber } = await authClient.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "SPC",
    p_padding: 4,
  });
  const { data: contract, error: contractErr } = await admin
    .from("supplier_contracts")
    .insert({
      tenant_id: tenantId,
      supplier_id: supRow.id,
      supplier_name: `${stamp} SPC Supplier`,
      contract_number: contractNumber,
      contract_sequence: Math.floor(Date.now() % 100000),
      agreement_type: "verbal",
      start_date: "2026-10-01",
      end_date: "2026-12-31",
      auto_renew: false,
      status: "active",
      expense_category: "Transport",
      sub_category: "Transport",
      wht_rate: 0,
      next_billing_date: "2026-10-01",
      notes: stamp,
    })
    .select("id")
    .single();
  probeContractId = contract?.id ?? null;
  await admin.from("supplier_contract_amendments").insert({
    tenant_id: tenantId,
    contract_id: contract.id,
    effective_date: "2026-10-01",
    new_monthly_amount: 500,
    change_reason: "Initial agreement",
  });
  await generateSupplierContractAccountsPayableCore({
    admin,
    tenantId,
    asOf: "2026-10-01",
  });
  const { error: repErr } = await authClient.rpc("record_supplier_contract_replacement_payment", {
    p_tenant_id: tenantId,
    p_contract_id: contract.id,
    p_created_by: signIn.user.id,
    p_service_date: "2026-10-12",
    p_replacement_name: "Auth replacement",
    p_deduction_amount: 50,
    p_payment_method: "company_cash",
    p_notes: stamp,
  });
  results.push([
    "Supplier contract replacement (authenticated)",
    !contractErr && !repErr ? "PASS" : `FAIL ${contractErr?.message ?? repErr?.message}`,
  ]);

  console.log("\nAuthenticated RPC results:");
  for (const [name, status] of results) {
    console.log(`  ${name}: ${status}`);
  }

  const anonClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: anonSaveErr } = await anonClient.rpc("save_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: null,
    p_business_unit_id: null,
    p_vendor_name: "Anon probe",
    p_invoice_number: `${stamp}-ANON`,
    p_expense_category: "Transport",
    p_sub_category: "Transport",
    p_description: stamp,
    p_invoice_date: "2026-10-01",
    p_due_date: "2026-10-31",
    p_amount: 100,
    p_amount_paid: 0,
    p_balance_due: 100,
    p_status: "Outstanding",
    p_gross_before_wht: 100,
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: 100,
    p_notes: stamp,
    p_source_type: null,
    p_tax_rows: [],
  });
  const anonRejected =
    !!anonSaveErr &&
    /permission denied|42501|not authorized|JWT|row-level security/i.test(anonSaveErr.message);
  console.log(
    `\n=== Anon save_accounts_payable (expect reject) === ${anonRejected ? "PASS" : `FAIL ${anonSaveErr?.message ?? "unexpected success"}`}`,
  );
  if (!anonRejected) {
    throw new Error("anon save_accounts_payable should be rejected");
  }
  } finally {
    await cleanupPrivilegeProbe(admin, tenantId, stamp, probeContractId, probeSupplierId);
    console.log("Privilege probe cleanup done.");
  }

  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
  console.log("Cleaned up ephemeral auth user.");

  await pgClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
