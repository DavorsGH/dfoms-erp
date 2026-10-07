/**
 * IC + production batch edit/delete via HTTP API as authenticated Davors user.
 *
 * npx tsx scripts/staging-only/prove-r1-http-ic-batch-as-user.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function createUser(admin: SupabaseClient) {
  const stamp = Date.now();
  const email = `r1.http.${stamp}@test.davors`;
  const password = `R1Http-${stamp}!Aa9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser");
  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: DAVORS,
    role: "super_admin",
    is_active: true,
  });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({ email, password });
  return { client, email, authUid: userData.user.id };
}

async function sessionCookie(client: SupabaseClient) {
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("No session");
  const cookieProject = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
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

async function setActiveBu(cookie: string, buId: string) {
  const res = await fetch(`${APP_URL}/api/account/active-business-unit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ selection: "unit", business_unit_id: buId }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(`active-business-unit: ${payload.error ?? res.status}`);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!url.includes(STAGING_REF)) throw new Error("Staging only");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { client, email, authUid } = await createUser(admin);
  console.log("User:", email);

  const { data: bu } = await admin
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
  const { data: mat } = await admin
    .from("raw_materials")
    .select("id")
    .eq("tenant_id", DAVORS)
    .limit(1)
    .single();
  if (!bu?.id || !fp?.id || !mat?.id) throw new Error("Missing BU/product/material");

  const cookie = await sessionCookie(client);
  await setActiveBu(cookie, bu.id);

  const today = new Date().toISOString().slice(0, 10);
  const { data: icRow, error: icInsErr } = await client
    .from("internal_consumption")
    .insert({
      tenant_id: DAVORS,
      product_id: fp.id,
      quantity: 1,
      consumption_date: today,
      reason: "R1 HTTP IC edit/delete test",
      business_unit_id: bu.id,
      recorded_by: "R1 HTTP test",
    })
    .select("id")
    .single();
  if (icInsErr || !icRow?.id) throw icInsErr ?? new Error("IC insert");

  const patchIc = await fetch(
    `${APP_URL}/api/inventory/internal-consumption/${icRow.id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        consumption_date: today,
        product_id: fp.id,
        quantity: 2,
        reason: "R1 HTTP IC patched",
        notes: "",
      }),
    },
  );
  const patchPayload = (await patchIc.json()) as { error?: string };
  if (!patchIc.ok) {
    throw new Error(`IC PATCH: ${patchPayload.error ?? patchIc.status}`);
  }
  console.log("PASS: IC PATCH");

  const delIc = await fetch(
    `${APP_URL}/api/inventory/internal-consumption/${icRow.id}`,
    { method: "DELETE", headers: { Cookie: cookie } },
  );
  const delPayload = (await delIc.json().catch(() => ({}))) as { error?: string };
  if (!delIc.ok) {
    throw new Error(`IC DELETE: ${delPayload.error ?? delIc.status}`);
  }
  console.log("PASS: IC DELETE");

  await client.rpc("record_raw_material_manual_adjustment", {
    p_tenant_id: DAVORS,
    p_material_id: mat.id,
    p_business_unit_id: bu.id,
    p_adjustment_type: "found_stock",
    p_quantity_delta: 5,
    p_cost_per_unit: 1,
    p_reason: "R1 HTTP batch seed",
    p_notes: null,
    p_created_by: authUid,
  });

  const batchNo = `R1HTTP-${Date.now()}`;
  const { data: batchId, error: batchErr } = await client.rpc("create_production_batch", {
    p_batch_number: batchNo,
    p_production_date: today,
    p_finished_product_id: fp.id,
    p_quantity_produced: 1,
    p_notes: "R1 HTTP batch test",
    p_materials: [{ material_id: mat.id, quantity_used: 0.001 }],
    p_manufacturing_date: null,
    p_expiration_date: null,
    p_business_unit_id: bu.id,
  });
  if (batchErr || !batchId) throw batchErr ?? new Error("batch create");

  const patchBatch = await fetch(
    `${APP_URL}/api/inventory/production-batches/${batchId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        production_date: today,
        finished_product_id: fp.id,
        quantity_produced: 2,
        notes: "R1 HTTP batch patched",
        materials: [{ material_id: mat.id, quantity_used: 0.002, cost_at_time: 1 }],
      }),
    },
  );
  const batchPatchPayload = (await patchBatch.json()) as { error?: string };
  if (!patchBatch.ok) {
    throw new Error(`Batch PATCH: ${batchPatchPayload.error ?? patchBatch.status}`);
  }
  console.log("PASS: production batch PATCH");

  const delBatch = await fetch(
    `${APP_URL}/api/inventory/production-batches/${batchId}`,
    { method: "DELETE", headers: { Cookie: cookie } },
  );
  const batchDelPayload = (await delBatch.json().catch(() => ({}))) as { error?: string };
  if (!delBatch.ok) {
    throw new Error(`Batch DELETE: ${batchDelPayload.error ?? delBatch.status}`);
  }
  console.log("PASS: production batch DELETE");

  const { data: rmSeed } = await admin
    .from("raw_material_stock_adjustments")
    .select("id")
    .eq("tenant_id", DAVORS)
    .eq("reason", "R1 HTTP batch seed")
    .maybeSingle();
  if (rmSeed?.id) {
    await admin.from("raw_material_stock_adjustments").delete().eq("id", rmSeed.id);
  }

  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
  console.log("Cleaned up HTTP test user.");
  console.log("\nPASS: R1 HTTP IC + production batch edit/delete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
