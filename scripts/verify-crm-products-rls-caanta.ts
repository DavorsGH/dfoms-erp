/**
 * Live RLS check: crm_products visibility for Caanta vs service role (Davors ERP tiers).
 *
 * Usage:
 *   npx tsx scripts/verify-crm-products-rls-caanta.ts
 *   npx tsx scripts/verify-crm-products-rls-caanta.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ERP_SUITE_CATEGORY } from "../app/dashboard/crm/products/products-utils";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";

const STAGING_CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const TEST_PASSWORD = "CrmProductsRls-Test-9Qx!";
const CRM_PRODUCT_SELECT =
  "id, name, category, tenant_id, product_type, unit_price, billing_cycle, is_active";

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
  return ".env.local";
}

async function resolveCaantaTenantId(admin: SupabaseClient): Promise<string> {
  const { data: bySlug } = await admin
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", "caanta")
    .maybeSingle();

  if (bySlug?.id) {
    return bySlug.id;
  }

  const { data: byName } = await admin
    .from("tenants")
    .select("id, name, slug")
    .ilike("name", "%caanta%")
    .limit(1)
    .maybeSingle();

  if (byName?.id) {
    return byName.id;
  }

  return STAGING_CAANTA_TENANT_ID;
}

async function signInAs(
  url: string,
  anon: string,
  email: string,
  password: string,
) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`signIn failed for ${email}: ${error.message}`);
  }
  return client;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), resolveEnvFile(process.argv.slice(2))));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";

  if (!url || !serviceKey || !anon) {
    throw new Error("Missing Supabase URL/keys in env file.");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const caantaTenantId = await resolveCaantaTenantId(admin);
  const stamp = Date.now().toString(36);
  const email = `crm.products.rls.caanta.${stamp}@test.davors`;
  let authUid: string | null = null;

  try {
    const { data: serviceErpSuite, error: serviceErpError } = await admin
      .from("crm_products")
      .select(CRM_PRODUCT_SELECT)
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("category", ERP_SUITE_CATEGORY);

    if (serviceErpError) {
      throw new Error(`service role Davors ERP query failed: ${serviceErpError.message}`);
    }

    const { data: serviceCaanta, error: serviceCaantaError } = await admin
      .from("crm_products")
      .select(CRM_PRODUCT_SELECT)
      .eq("tenant_id", caantaTenantId);

    if (serviceCaantaError) {
      throw new Error(
        `service role Caanta query failed: ${serviceCaantaError.message}`,
      );
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(createError?.message ?? "Failed to create temp Caanta user");
    }
    authUid = created.user.id;

    const { error: accountError } = await admin.from("user_accounts").insert({
      auth_uid: authUid,
      tenant_id: caantaTenantId,
      role: "super_admin",
      email,
      is_active: true,
    });
    if (accountError) {
      throw new Error(`user_accounts insert failed: ${accountError.message}`);
    }

    const caantaClient = await signInAs(url, anon, email, TEST_PASSWORD);

    const { data: caantaProducts, error: caantaProductsError } =
      await caantaClient.from("crm_products").select(CRM_PRODUCT_SELECT);

    if (caantaProductsError) {
      throw new Error(
        `Caanta authenticated crm_products query failed: ${caantaProductsError.message}`,
      );
    }

    const caantaErpSuite = (caantaProducts ?? []).filter(
      (row) => (row.category ?? "").trim() === ERP_SUITE_CATEGORY,
    );
    const caantaDavorsTenantRows = (caantaProducts ?? []).filter(
      (row) => row.tenant_id === DAVORS_TENANT_ID,
    );
    const caantaPlatformBilling = (caantaProducts ?? []).filter(
      (row) => (row.category ?? "").trim() === "Platform Billing",
    );

    console.log("=== crm_products RLS verification ===");
    console.log(`Caanta tenant_id: ${caantaTenantId}`);
    console.log(
      `Service role — Davors ERP Suite rows (tenant_id=${DAVORS_TENANT_ID}): ${serviceErpSuite?.length ?? 0}`,
    );
    console.log(
      `Service role — Caanta tenant rows (all categories): ${serviceCaanta?.length ?? 0}`,
    );
    console.log(
      `Caanta authenticated — total crm_products visible: ${caantaProducts?.length ?? 0}`,
    );
    console.log(
      `Caanta authenticated — ERP Suite rows: ${caantaErpSuite.length}`,
    );
    console.log(
      `Caanta authenticated — Davors tenant_id rows: ${caantaDavorsTenantRows.length}`,
    );
    console.log(
      `Caanta authenticated — Platform Billing DB rows: ${caantaPlatformBilling.length}`,
    );

    if (caantaErpSuite.length > 0 || caantaDavorsTenantRows.length > 0) {
      console.error("FAIL: Caanta session can see Davors/system catalog rows.");
      process.exitCode = 1;
      return;
    }

    console.log(
      "PASS: Caanta authenticated client returns zero ERP Suite / Davors tenant crm_products rows.",
    );
  } finally {
    if (authUid) {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
