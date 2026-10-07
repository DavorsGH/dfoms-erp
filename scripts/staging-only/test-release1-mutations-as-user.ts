/**
 * Staging: mutation smoke tests as authenticated tenant users (anon + session), not service role.
 *
 * npx tsx scripts/staging-only/test-release1-mutations-as-user.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FY = 2026;
const BS_MONTH = 9;

type Result = { name: string; tenant: string; ok: boolean; detail?: string };

const results: Result[] = [];

function record(
  name: string,
  tenant: string,
  ok: boolean,
  detail?: string,
  skip = false,
) {
  results.push({ name, tenant, ok: skip ? true : ok, detail: skip ? `SKIP: ${detail}` : detail });
  const label = skip ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`${label} [${tenant}] ${name}${detail ? `: ${detail}` : ""}`);
}

async function createTenantUser(
  admin: SupabaseClient,
  tenantId: string,
  label: string,
): Promise<{ email: string; password: string; client: SupabaseClient }> {
  const stamp = Date.now();
  const email = `r1-mut.${label}.${stamp}@test.davors`;
  const password = `R1Mut-${stamp}!Aa9`;

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) {
    throw userErr ?? new Error("createUser failed");
  }

  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: tenantId,
    role: "super_admin",
    is_active: true,
  });

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error: signErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr) {
    throw signErr;
  }

  return { email, password, client };
}

async function sessionCookie(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) {
    throw new Error("No session");
  }
  const cookieProject = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
    ".",
  )[0];
  return `sb-${cookieProject}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: session.user,
    }),
  )}`;
}

async function assertScopedBalanceSheet(
  admin: SupabaseClient,
  tenantId: string,
  buId: string,
  tenantLabel: string,
  step: string,
) {
  const data = await fetchBalanceSheetPageData(admin, tenantId, {
    activeBusinessUnitId: buId,
    viewAllBusinessUnits: false,
  });
  const report = buildStandardBalanceSheetReport(data, tenantId, FY);
  const check = getBalanceSheetMonthCheck(report, BS_MONTH);
  record(
    `BS check after ${step}`,
    tenantLabel,
    check.isBalanced,
    check.isBalanced ? undefined : `Oct diff=${check.difference}`,
  );
}

async function fpAdjustmentTypes(
  client: SupabaseClient,
  admin: SupabaseClient,
  tenantId: string,
  buId: string,
  productId: string,
  tenantLabel: string,
) {
  const userId = (await client.auth.getUser()).data.user?.id ?? null;
  const types: Array<{
    name: string;
    type: string;
    delta: number;
    cost: number | null;
  }> = [
    { name: "FP opening_balance", type: "opening_balance", delta: 1, cost: 0.79 },
    { name: "FP found_stock", type: "found_stock", delta: 1, cost: 0.79 },
    { name: "FP correction (+)", type: "correction", delta: 1, cost: null },
    { name: "FP write_off", type: "write_off", delta: -1, cost: null },
  ];

  for (const t of types) {
    const { error } = await client.rpc("record_finished_product_manual_adjustment", {
      p_tenant_id: tenantId,
      p_product_id: productId,
      p_business_unit_id: buId,
      p_adjustment_type: t.type,
      p_quantity_delta: t.delta,
      p_cost_per_unit: t.cost,
      p_reason: `R1 user test ${t.type}`,
      p_notes: null,
      p_created_by: userId,
      p_manufacturing_date: null,
      p_expiration_date: null,
    });
    record(t.name, tenantLabel, !error, error?.message);
    if (!error && tenantLabel === "Caanta") {
      await assertScopedBalanceSheet(admin, tenantId, buId, tenantLabel, t.name);
    }
  }
}

async function rmAdjustmentTypes(
  client: SupabaseClient,
  admin: SupabaseClient,
  tenantId: string,
  buId: string,
  materialId: string,
  tenantLabel: string,
) {
  const userId = (await client.auth.getUser()).data.user?.id ?? null;
  const types: Array<{
    name: string;
    type: string;
    delta: number;
    cost: number | null;
  }> = [
    { name: "RM opening_balance", type: "opening_balance", delta: 1, cost: 1 },
    { name: "RM found_stock", type: "found_stock", delta: 1, cost: 1 },
    { name: "RM correction (+)", type: "correction", delta: 1, cost: null },
    { name: "RM write_off", type: "write_off", delta: -1, cost: null },
  ];

  for (const t of types) {
    const { error } = await client.rpc("record_raw_material_manual_adjustment", {
      p_tenant_id: tenantId,
      p_material_id: materialId,
      p_business_unit_id: buId,
      p_adjustment_type: t.type,
      p_quantity_delta: t.delta,
      p_cost_per_unit: t.cost,
      p_reason: `R1 user test ${t.type}`,
      p_notes: null,
      p_created_by: userId,
    });
    record(t.name, tenantLabel, !error, error?.message);
    if (!error && tenantLabel === "Caanta") {
      await assertScopedBalanceSheet(admin, tenantId, buId, tenantLabel, t.name);
    }
  }
}

async function setActiveBusinessUnit(
  cookie: string,
  businessUnitId: string,
): Promise<void> {
  const res = await fetch(`${APP_URL}/api/account/active-business-unit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      selection: "unit",
      business_unit_id: businessUnitId,
    }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `active-business-unit ${res.status}`);
  }
}

async function testFpFoundStockApi(
  client: SupabaseClient,
  productId: string,
  facilitiesBuId: string,
  tenantLabel: string,
) {
  try {
    const cookie = await sessionCookie(client);
    await setActiveBusinessUnit(cookie, facilitiesBuId);
    const res = await fetch(`${APP_URL}/api/inventory/finished-product-adjustments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        product_id: productId,
        adjustment_type: "found_stock",
        quantity_delta: 1,
        cost_per_unit: 0.79,
        reason: "R1 API found stock test",
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    record(
      "FP found_stock (HTTP API)",
      tenantLabel,
      res.ok,
      res.ok ? undefined : payload.error ?? String(res.status),
    );
  } catch (e) {
    record(
      "FP found_stock (HTTP API)",
      tenantLabel,
      false,
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!url.includes(STAGING_REF)) {
    throw new Error("Staging only");
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const davorsUser = await createTenantUser(admin, DAVORS, "davors");
  const caantaUser = await createTenantUser(admin, CAANTA, "caanta");

  const { data: davorsBu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", DAVORS)
    .ilike("name", "%Facilities%")
    .single();
  const { data: fp } = await admin
    .from("finished_products")
    .select("id")
    .eq("tenant_id", DAVORS)
    .eq("product_code", "SKU-1003")
    .single();
  const { data: rm } = await admin
    .from("raw_materials")
    .select("id")
    .eq("tenant_id", DAVORS)
    .limit(1)
    .single();

  if (!davorsBu?.id || !fp?.id) {
    throw new Error("Davors Facilities BU or SKU-1003 missing on staging");
  }

  record(
    "Davors FP/RM adjustments",
    "Davors",
    true,
    "Skipped — no new Davors inventory test data until user UI retest",
    true,
  );

  const { data: caantaBu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  const { data: caantaFp } = await admin
    .from("finished_products")
    .select("id")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();

  if (caantaBu?.id && caantaFp?.id) {
    await fpAdjustmentTypes(
      caantaUser.client,
      admin,
      CAANTA,
      caantaBu.id,
      caantaFp.id,
      "Caanta",
    );
    const { data: caantaRm } = await admin
      .from("raw_materials")
      .select("id")
      .eq("tenant_id", CAANTA)
      .limit(1)
      .maybeSingle();
    if (caantaRm?.id) {
      await rmAdjustmentTypes(
        caantaUser.client,
        admin,
        CAANTA,
        caantaBu.id,
        caantaRm.id,
        "Caanta",
      );
    }
  } else {
    record("Caanta FP adjustments", "Caanta", false, "No BU or FP on staging");
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: icIns, error: icErr } = await davorsUser.client
    .from("internal_consumption")
    .insert({
      tenant_id: DAVORS,
      product_id: fp.id,
      quantity: 1,
      consumption_date: today,
      reason: "R1 authenticated IC create test",
      business_unit_id: davorsBu.id,
      recorded_by: "R1 test",
    })
    .select("id")
    .single();
  record("IC create (authenticated insert)", "Davors", !icErr, icErr?.message);

  if (icIns?.id) {
    const { error: icDel } = await admin.rpc("delete_internal_consumption_entry", {
      p_tenant_id: DAVORS,
      p_entry_id: icIns.id,
    });
    record(
      "IC delete (service cleanup after user create)",
      "Davors",
      !icDel,
      icDel?.message,
    );
  }

  const { data: mat } = await admin
    .from("raw_materials")
    .select("id")
    .eq("tenant_id", DAVORS)
    .limit(1)
    .single();
  if (mat?.id) {
    const userId = (await davorsUser.client.auth.getUser()).data.user?.id ?? null;
    await davorsUser.client.rpc("record_raw_material_manual_adjustment", {
      p_tenant_id: DAVORS,
      p_material_id: mat.id,
      p_business_unit_id: davorsBu.id,
      p_adjustment_type: "found_stock",
      p_quantity_delta: 5,
      p_cost_per_unit: 1,
      p_reason: "R1 batch test stock seed",
      p_notes: null,
      p_created_by: userId,
    });
    const batchNo = `R1T-${Date.now()}`;
    const { error: batchErr } = await davorsUser.client.rpc("create_production_batch", {
      p_batch_number: batchNo,
      p_production_date: today,
      p_finished_product_id: fp.id,
      p_quantity_produced: 1,
      p_notes: "R1 user batch test",
      p_materials: [{ material_id: mat.id, quantity_used: 0.001 }],
      p_manufacturing_date: null,
      p_expiration_date: null,
      p_business_unit_id: davorsBu.id,
    });
    record("Production batch create (RPC)", "Davors", !batchErr, batchErr?.message);
  }

  record(
    "Bulk import opening stock",
    "—",
    true,
    "Manual UI / bulk-import job — not automated here",
    true,
  );
  record(
    "Payroll lock/reopen",
    "—",
    true,
    "Use Caanta Part 2 test plan (destructive)",
    true,
  );

  const { data: caantaEmp } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  const { data: payAcct } = await admin
    .from("payment_accounts")
    .select("id")
    .eq("tenant_id", CAANTA)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (caantaEmp?.employee_id && payAcct?.id && caantaBu?.id) {
    const { error: advErr } = await caantaUser.client.rpc("save_salary_advances_bulk", {
      p_payload: {
        tenant_id: CAANTA,
        business_unit_id: caantaBu.id,
        advances: [
          {
            employee_id: caantaEmp.employee_id,
            amount: 10,
            date_issued: today,
            payment_account_id: payAcct.id,
            approved_by: "R1 Test Approver",
          },
        ],
      },
    });
    record("Salary advance save (RPC)", "Caanta", !advErr, advErr?.message);
  } else {
    record(
      "Salary advance save (RPC)",
      "Caanta",
      true,
      "missing employee/payment account/BU",
      true,
    );
  }

  const failed = results.filter((r) => !r.ok && !r.detail?.startsWith("SKIP:"));
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
