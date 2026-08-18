/**
 * Two-tenant RLS isolation test for user_activity_log (staging).
 *
 * Seeds login rows for tenant A and B, signs in as each tenant's super_admin,
 * asserts zero cross-tenant leakage on unfiltered SELECT.
 *
 * Usage:
 *   npx tsx scripts/test-user-activity-log-rls-staging.ts
 *   npx tsx scripts/test-user-activity-log-rls-staging.ts --env-file .env.staging.local
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID, ERP_SUITE_SIGNUP_SOURCE } from "../utils/tenant-signup";
import { assert, loadEnvFromArgv } from "./lib/env";

const PASSWORD = "UalRlsIso-Test-9Kp!";

type CleanupState = {
  tenantIds: string[];
  authUids: string[];
  subscriptionIds: string[];
  customerIds: string[];
  activityIds: string[];
};

const cleanup: CleanupState = {
  tenantIds: [],
  authUids: [],
  subscriptionIds: [],
  customerIds: [],
  activityIds: [],
};

async function createTenant(admin: SupabaseClient, label: "A" | "B", stamp: string) {
  const slug = `ual-rls-${label.toLowerCase()}-${stamp}`.slice(0, 63);
  const { data, error } = await admin
    .from("tenants")
    .insert({
      name: `UAL RLS ${label} ${stamp}`,
      slug,
      status: "active",
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? `tenant ${label} insert failed`);
  cleanup.tenantIds.push(data.id);
  return data.id as string;
}

async function ensureSubscription(
  admin: SupabaseClient,
  linkedTenantId: string,
  label: "A" | "B",
  stamp: string,
) {
  const clientId = `UAL-${label}-${stamp}`.slice(0, 32);
  const { error: customerError } = await admin.from("customers").insert({
    tenant_id: DAVORS_TENANT_ID,
    client_id: clientId,
    client_name: `UAL RLS ${label} ${stamp}`,
    customer_type: "digital_subscriber",
    source: ERP_SUITE_SIGNUP_SOURCE,
    status: "lead",
  });
  assert(!customerError, customerError?.message ?? "customers insert failed");
  cleanup.customerIds.push(clientId);

  const { data, error } = await admin
    .from("crm_subscriptions")
    .insert({
      tenant_id: DAVORS_TENANT_ID,
      customer_id: clientId,
      linked_tenant_id: linkedTenantId,
      subscription_status: "trialing",
      billing_waived: true,
      trial_end_date: "2099-12-31T23:59:59Z",
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "crm_subscriptions insert failed");
  cleanup.subscriptionIds.push(data.id);
}

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
  cleanup.authUids.push(authData.user.id);

  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authData.user.id,
    email,
    role: "super_admin",
    is_active: true,
    tenant_id: tenantId,
  });
  assert(!accountError, accountError?.message ?? "user_accounts insert failed");
  return authData.user.id;
}

async function seedActivityRow(
  admin: SupabaseClient,
  tenantId: string,
  marker: string,
) {
  const { data, error } = await admin
    .from("user_activity_log")
    .insert({
      persona: "staff",
      tenant_id: tenantId,
      email: `${marker}@example.com`,
      event_name: "login.password_success",
      status: "success",
      ip: "127.0.0.1",
      metadata: { method: "password", marker },
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "activity insert failed");
  cleanup.activityIds.push(data.id);
  return data.id as string;
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

async function assertActivityIsolation(
  client: SupabaseClient,
  ownTenantId: string,
  otherTenantId: string,
  ownMarker: string,
  otherMarker: string,
  label: string,
) {
  const { data, error } = await client
    .from("user_activity_log")
    .select("id, tenant_id, email, metadata");
  assert(!error, `${label} read failed: ${error?.message}`);

  const rows = data ?? [];
  const foreign = rows.filter((row) => row.tenant_id === otherTenantId);
  const foreignMarker = rows.filter((row) => {
    const metadata = row.metadata as { marker?: string } | null;
    return metadata?.marker === otherMarker;
  });

  assert(
    foreign.length === 0,
    `LEAK (${label}): saw ${foreign.length} row(s) from other tenant`,
  );
  assert(
    foreignMarker.length === 0,
    `LEAK (${label}): saw ${foreignMarker.length} row(s) with other marker`,
  );

  const own = rows.filter((row) => row.tenant_id === ownTenantId);
  assert(own.length >= 1, `${label} cannot see own tenant rows`);

  console.log(
    `PASS ${label}: ${rows.length} visible row(s), 0 cross-tenant leakage`,
  );
}

async function runCleanup(admin: SupabaseClient) {
  for (const id of cleanup.activityIds) {
    await admin.from("user_activity_log").delete().eq("id", id);
  }
  for (const authUid of cleanup.authUids) {
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  }
  for (const id of cleanup.subscriptionIds) {
    await admin.from("crm_subscriptions").delete().eq("id", id);
  }
  for (const clientId of cleanup.customerIds) {
    await admin
      .from("customers")
      .delete()
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("client_id", clientId);
  }
  for (const tenantId of cleanup.tenantIds) {
    await admin.from("tenants").delete().eq("id", tenantId);
  }
}

async function main() {
  loadEnvFromArgv(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  assert(url && anon && serviceKey, "Missing Supabase env vars");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now().toString(36);
  const tenantA = await createTenant(admin, "A", stamp);
  const tenantB = await createTenant(admin, "B", stamp);
  await ensureSubscription(admin, tenantA, "A", stamp);
  await ensureSubscription(admin, tenantB, "B", stamp);

  const markerA = `UAL-A-${stamp}`;
  const markerB = `UAL-B-${stamp}`;
  const emailA = `ual-rls-a-${stamp}@example.com`;
  const emailB = `ual-rls-b-${stamp}@example.com`;

  await createSuperAdmin(admin, tenantA, emailA);
  await createSuperAdmin(admin, tenantB, emailB);
  await seedActivityRow(admin, tenantA, markerA);
  await seedActivityRow(admin, tenantB, markerB);

  try {
    const clientA = await signInAs(url, anon, emailA);
    await assertActivityIsolation(
      clientA,
      tenantA,
      tenantB,
      markerA,
      markerB,
      "tenant A super_admin",
    );

    const clientB = await signInAs(url, anon, emailB);
    await assertActivityIsolation(
      clientB,
      tenantB,
      tenantA,
      markerB,
      markerA,
      "tenant B super_admin",
    );

    console.log("OK: user_activity_log two-tenant RLS isolation passed");
  } finally {
    await runCleanup(admin);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
