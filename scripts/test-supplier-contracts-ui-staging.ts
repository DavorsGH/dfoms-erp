/**
 * Staging: supplier contract UI smoke via HTTP (list RSC + API create/read/delete).
 * For full browser checks, run with APP_URL=http://localhost:3000 after npm run dev.
 *
 *   npx tsx scripts/test-supplier-contracts-ui-staging.ts --env-file .env.staging.local
 */
import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TENANT = "00000001-0000-4000-8000-000000000001";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url.includes("wieflwbfdmjtsdnwbfii")) throw new Error("Staging only");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stamp = Date.now();
  const email = `spc-ui-smoke.${stamp}@test.davors`;
  const password = `SpcSmoke-${stamp}!Aa8`;

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr;

  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: TENANT,
    role: "super_admin",
    is_active: true,
  });

  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr || !session.session) throw signErr;

  const cookieProject = new URL(url).hostname.split(".")[0];
  const cookie = `sb-${cookieProject}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
      expires_at: session.session.expires_at,
      expires_in: session.session.expires_in,
      token_type: "bearer",
      user: session.session.user,
    }),
  )}`;

  const listRes = await fetch(`${APP_URL}/dashboard/finance/supplier-contracts`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  console.log("GET list page:", listRes.status, listRes.headers.get("content-type")?.slice(0, 40));
  const listHtml = await listRes.text();
  console.log(
    "List HTML contains heading:",
    listHtml.includes("Supplier Contracts"),
    "empty state:",
    listHtml.includes("No supplier contracts") || listHtml.includes("New supplier contract"),
  );

  const supplierRes = await fetch(`${APP_URL}/api/finance/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: `UI Smoke Supplier ${stamp}` }),
  });
  const supplierPayload = (await supplierRes.json()) as { supplier?: { id: string } };
  if (!supplierRes.ok || !supplierPayload.supplier) {
    throw new Error("supplier create failed");
  }
  const supplierId = supplierPayload.supplier.id;

  const { data: buRow } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", TENANT)
    .ilike("name", "%Davors Facilities%")
    .maybeSingle();

  const createRes = await fetch(`${APP_URL}/api/supplier-contracts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      supplier_id: supplierId,
      agreement_type: "verbal",
      start_date: "2026-10-01",
      end_date: "2027-09-30",
      auto_renew: false,
      status: "active",
      expense_category: "Direct Operational",
      sub_category: "Transportation",
      wht_rate: 0,
      initial_monthly_amount: 2000,
      mid_month_reminder_enabled: false,
      business_unit_id: buRow?.id ?? null,
    }),
  });
  const created = (await createRes.json()) as { contract?: { id: string }; error?: string };
  if (!createRes.ok || !created.contract) {
    throw new Error(created.error ?? "contract create failed");
  }
  const contractId = created.contract.id;
  console.log("Created contract:", contractId);

  const detailRes = await fetch(`${APP_URL}/api/supplier-contracts/${contractId}`, {
    headers: { Cookie: cookie },
  });
  console.log("GET detail API:", detailRes.status);

  const detailPage = await fetch(`${APP_URL}/dashboard/finance/supplier-contracts/${contractId}`, {
    headers: { Cookie: cookie },
  });
  console.log("GET detail page:", detailPage.status);

  await admin.from("supplier_contracts").delete().eq("id", contractId);
  await admin.from("suppliers").delete().eq("id", supplierId);
  await admin.from("user_accounts").delete().eq("auth_uid", userData.user.id);
  await admin.auth.admin.deleteUser(userData.user.id);

  console.log("PASS: supplier contracts UI smoke (HTTP)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
