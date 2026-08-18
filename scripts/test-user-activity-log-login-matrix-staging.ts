/**
 * Login matrix smoke test for user_activity_log (staging).
 *
 * Exercises staff / lessee / landlord password success + failure logging
 * using the same logAuthActivity helper as production login actions.
 *
 * Usage:
 *   npx tsx scripts/test-user-activity-log-login-matrix-staging.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DAVORS_TENANT_ID, ERP_SUITE_SIGNUP_SOURCE } from "../utils/tenant-signup";
import {
  logAuthActivity,
  logUserActivity,
  resolveAuthActivityTenantId,
} from "../utils/user-activity-log-write";
import { assert, loadEnvFromArgv } from "./lib/env";

const PASSWORD = "UalMatrix-Test-7Mn!";
const WRONG_PASSWORD = "UalMatrix-Wrong-0Xq!";
const TEST_IP = "127.0.0.1";

type CleanupState = {
  tenantIds: string[];
  authUids: string[];
  lesseeIds: string[];
  subscriptionIds: string[];
  customerIds: string[];
};

const cleanup: CleanupState = {
  tenantIds: [],
  authUids: [],
  lesseeIds: [],
  subscriptionIds: [],
  customerIds: [],
};

async function createTenant(admin: SupabaseClient, stamp: string) {
  const slug = `ual-matrix-${stamp}`.slice(0, 63);
  const { data, error } = await admin
    .from("tenants")
    .insert({ name: `UAL Matrix ${stamp}`, slug, status: "active" })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "tenant insert failed");
  cleanup.tenantIds.push(data.id);
  return data.id as string;
}

async function ensureSubscription(admin: SupabaseClient, tenantId: string, stamp: string) {
  const clientId = `UALM-${stamp}`.slice(0, 32);
  await admin.from("customers").insert({
    tenant_id: DAVORS_TENANT_ID,
    client_id: clientId,
    client_name: `UAL Matrix ${stamp}`,
    customer_type: "digital_subscriber",
    source: ERP_SUITE_SIGNUP_SOURCE,
    status: "lead",
  });
  cleanup.customerIds.push(clientId);

  const { data, error } = await admin
    .from("crm_subscriptions")
    .insert({
      tenant_id: DAVORS_TENANT_ID,
      customer_id: clientId,
      linked_tenant_id: tenantId,
      subscription_status: "trialing",
      billing_waived: true,
      trial_end_date: "2099-12-31T23:59:59Z",
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "subscription insert failed");
  cleanup.subscriptionIds.push(data.id);
}

async function createAuthUser(admin: SupabaseClient, email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!error && data.user, error?.message ?? "auth user create failed");
  cleanup.authUids.push(data.user.id);
  return data.user.id;
}

async function waitForActivity(
  admin: SupabaseClient,
  email: string,
  eventName: string,
  timeoutMs = 10000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data, error } = await admin
      .from("user_activity_log")
      .select("id, persona, tenant_id, event_name, status, metadata")
      .eq("email", email.toLowerCase())
      .eq("event_name", eventName)
      .order("created_at", { ascending: false })
      .limit(1);
    assert(!error, error?.message ?? "activity query failed");
    if (data && data.length > 0) {
      return data[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${eventName} on ${email}`);
}

async function simulateStaffLogin(
  admin: SupabaseClient,
  email: string,
  password: string,
  tenantId: string,
) {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    logAuthActivity({
      persona: "staff",
      eventName: "login.password_failure",
      status: "failure",
      email,
      ip: TEST_IP,
      method: "password",
      failureReason: error.message,
    });
    return { ok: false as const };
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  assert(user, "staff auth user missing after sign-in");
  const resolvedTenant = await resolveAuthActivityTenantId(
    { persona: "staff", authUserId: user.id },
    admin,
  );
  logAuthActivity({
    persona: "staff",
    eventName: "login.password_success",
    status: "success",
    email,
    ip: TEST_IP,
    tenantId: resolvedTenant ?? tenantId,
    authUserId: user.id,
    method: "password",
  });
  return { ok: true as const, authUserId: user.id };
}

async function simulatePortalLogin(
  admin: SupabaseClient,
  persona: "lessee" | "landlord",
  email: string,
  password: string,
  tenantId: string,
) {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    logAuthActivity({
      persona,
      eventName: "login.password_failure",
      status: "failure",
      email,
      ip: TEST_IP,
      method: "password",
      failureReason: error?.message ?? "invalid_credentials",
    });
    return { ok: false as const };
  }

  const table = persona === "lessee" ? "lessees" : "landlords";
  const { data: row } = await admin
    .from(table)
    .select("tenant_id")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (!row) {
    logAuthActivity({
      persona,
      eventName: "login.password_failure",
      status: "failure",
      email,
      ip: TEST_IP,
      authUserId: data.user.id,
      method: "password",
      failureReason: "wrong_portal",
    });
    return { ok: false as const };
  }

  logAuthActivity({
    persona,
    eventName: "login.password_success",
    status: "success",
    email,
    ip: TEST_IP,
    tenantId: row.tenant_id ?? tenantId,
    authUserId: data.user.id,
    method: "password",
  });
  return { ok: true as const, authUserId: data.user.id };
}

async function runCleanup(admin: SupabaseClient, stamp: string) {
  await admin
    .from("user_activity_log")
    .delete()
    .ilike("email", `%ual-matrix-${stamp}%`);

  for (const lesseeId of cleanup.lesseeIds) {
    await admin.from("lessees").delete().eq("lessee_id", lesseeId);
  }
  for (const authUid of cleanup.authUids) {
    await admin.from("landlords").delete().eq("auth_user_id", authUid);
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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  assert(url && serviceKey, "Missing Supabase env vars");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await logUserActivity(
    {
      persona: "staff",
      eventName: "login.password_failure",
      status: "failure",
      email: "logger-never-throws@test.local",
      metadata: { method: "password", password: "must-not-persist" },
    },
    admin,
  );

  const stamp = Date.now().toString(36);
  const tenantId = await createTenant(admin, stamp);
  await ensureSubscription(admin, tenantId, stamp);

  const staffEmail = `ual-matrix-staff-${stamp}@example.com`;
  const lesseeEmail = `ual-matrix-lessee-${stamp}@example.com`;
  const landlordEmail = `ual-matrix-landlord-${stamp}@example.com`;

  const staffAuthUid = await createAuthUser(admin, staffEmail);
  await admin.from("user_accounts").insert({
    auth_uid: staffAuthUid,
    email: staffEmail,
    role: "super_admin",
    is_active: true,
    tenant_id: tenantId,
  });

  const lesseeAuthUid = await createAuthUser(admin, lesseeEmail);
  const lesseeId = randomUUID();
  const nowIso = new Date().toISOString();
  const { error: lesseeInsertError } = await admin.from("lessees").insert({
    lessee_id: lesseeId,
    tenant_id: tenantId,
    auth_user_id: lesseeAuthUid,
    full_name: "UAL Matrix Lessee",
    email: lesseeEmail,
    phone: "+233200000000",
    status: "active",
    created_at: nowIso,
    updated_at: nowIso,
  });
  assert(!lesseeInsertError, lesseeInsertError?.message ?? "lessee insert failed");
  cleanup.lesseeIds.push(lesseeId);

  const landlordAuthUid = await createAuthUser(admin, landlordEmail);
  const landlordTenantId = await createTenant(admin, `${stamp}-ll`);
  const landlordNow = new Date().toISOString();
  const { error: landlordInsertError } = await admin.from("landlords").insert({
    tenant_id: landlordTenantId,
    auth_user_id: landlordAuthUid,
    approval_status: "approved",
    landlord_type: "platform_only",
    sms_credit_balance: 0,
    created_at: landlordNow,
    updated_at: landlordNow,
  });
  assert(!landlordInsertError, landlordInsertError?.message ?? "landlord insert failed");

  try {
    const staffFail = await simulateStaffLogin(
      admin,
      staffEmail,
      WRONG_PASSWORD,
      tenantId,
    );
    assert(!staffFail.ok, "staff wrong password should fail");
    await waitForActivity(admin, staffEmail, "login.password_failure");

    const staffOk = await simulateStaffLogin(admin, staffEmail, PASSWORD, tenantId);
    assert(staffOk.ok, "staff login should succeed");
    const staffOkRow = await waitForActivity(
      admin,
      staffEmail,
      "login.password_success",
    );
    assert(staffOkRow.persona === "staff", "staff persona");
    assert(staffOkRow.tenant_id === tenantId, "staff tenant_id");

    const lesseeFail = await simulatePortalLogin(
      admin,
      "lessee",
      lesseeEmail,
      WRONG_PASSWORD,
      tenantId,
    );
    assert(!lesseeFail.ok, "lessee wrong password should fail");
    await waitForActivity(admin, lesseeEmail, "login.password_failure");

    const lesseeOk = await simulatePortalLogin(
      admin,
      "lessee",
      lesseeEmail,
      PASSWORD,
      tenantId,
    );
    assert(lesseeOk.ok, "lessee login should succeed");
    const lesseeOkRow = await waitForActivity(
      admin,
      lesseeEmail,
      "login.password_success",
    );
    assert(lesseeOkRow.persona === "lessee", "lessee persona");
    assert(lesseeOkRow.tenant_id === tenantId, "lessee tenant_id");

    const landlordFail = await simulatePortalLogin(
      admin,
      "landlord",
      landlordEmail,
      WRONG_PASSWORD,
      landlordTenantId,
    );
    assert(!landlordFail.ok, "landlord wrong password should fail");
    await waitForActivity(admin, landlordEmail, "login.password_failure");

    const landlordOk = await simulatePortalLogin(
      admin,
      "landlord",
      landlordEmail,
      PASSWORD,
      landlordTenantId,
    );
    assert(landlordOk.ok, "landlord login should succeed");
    const landlordOkRow = await waitForActivity(
      admin,
      landlordEmail,
      "login.password_success",
    );
    assert(landlordOkRow.persona === "landlord", "landlord persona");
    assert(landlordOkRow.tenant_id === landlordTenantId, "landlord tenant_id");

    console.log("OK: login matrix smoke test passed (staff, lessee, landlord)");
  } finally {
    await runCleanup(admin, stamp);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
