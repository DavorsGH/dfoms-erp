/**
 * Staging: subscription payment method API + Paystack integration.
 *
 * Prerequisites:
 *   - npm run dev (or next start) on APP_URL with staging Supabase/Paystack env
 *   - .env.staging.local with sk_test_ + wieflwbfdmjtsdnwbfii
 *
 * Usage:
 *   npx tsx scripts/test-billing-payment-method-staging.ts
 *   npx tsx scripts/test-billing-payment-method-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { DAVORS_TENANT_ID, ERP_SUITE_SIGNUP_SOURCE } from "../utils/tenant-signup";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PAYSTACK_BASE = "https://api.paystack.co";

const APP_URL = (process.env.STAGING_APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type StepResult = {
  step: string;
  pass: boolean;
  detail: string;
};

const results: StepResult[] = [];

function record(step: string, pass: boolean, detail: string) {
  results.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

type CookieRow = { name: string; value: string };

function buildCookieHeaderFromStore(cookieStore: CookieRow[]): string {
  return cookieStore.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function signInAndBuildCookieHeader(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string> {
  const cookieStore: CookieRow[] = [];
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore;
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          const index = cookieStore.findIndex((row) => row.name === cookie.name);
          if (index >= 0) {
            cookieStore[index] = { name: cookie.name, value: cookie.value };
          } else {
            cookieStore.push({ name: cookie.name, value: cookie.value });
          }
        }
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  assert(!error, `sign-in failed for ${email}: ${error?.message}`);
  assert(cookieStore.length > 0, `no auth cookies after sign-in for ${email}`);
  return buildCookieHeaderFromStore(cookieStore);
}

async function authedFetch(
  cookieHeader: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${APP_URL}${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      ...(init?.headers ?? {}),
      Cookie: cookieHeader,
    },
  });
}

async function fetchPaystackSubscriptionDirect(
  secretKey: string,
  subscriptionCode: string,
) {
  const response = await fetch(
    `${PAYSTACK_BASE}/subscription/${encodeURIComponent(subscriptionCode)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: {
      authorization?: {
        last4?: string;
        brand?: string;
        card_type?: string;
        exp_month?: string | number;
        exp_year?: string | number;
      };
    };
  } | null;
  return { response, payload };
}

async function fetchManageLinkDirect(secretKey: string, subscriptionCode: string) {
  const response = await fetch(
    `${PAYSTACK_BASE}/subscription/${encodeURIComponent(subscriptionCode)}/manage/link`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: { link?: string };
  } | null;
  return { response, payload };
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv);
  console.log(`Using env file: ${envFile}`);
  console.log(`APP_URL: ${APP_URL}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const secretKey = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
  const superAdminPassword =
    process.env.BILLING_PAYMENT_METHOD_TEST_PASSWORD?.trim() ??
    process.env.BILLING_VERIFY_TEST_PASSWORD?.trim() ??
    "ikechuku";

  assert(supabaseUrl.includes(STAGING_REF), "Refusing non-staging Supabase URL");
  assert(secretKey.startsWith("sk_test_"), "Need Paystack sk_test_ key");
  assert(anonKey && serviceKey, "Missing Supabase keys");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Step 1: super admin + active subscription — masked card from Paystack ---
  const { data: caantaSub, error: caantaSubError } = await admin
    .from("crm_subscriptions")
    .select(
      "id, linked_tenant_id, subscription_status, paystack_subscription_id",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("linked_tenant_id", CAANTA_TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  assert(!caantaSubError, caantaSubError?.message ?? "caanta sub query failed");
  const subscriptionCode = caantaSub?.paystack_subscription_id?.trim() ?? "";
  assert(subscriptionCode, "Caanta staging row missing paystack_subscription_id");

  const paystackFetch = await fetchPaystackSubscriptionDirect(
    secretKey,
    subscriptionCode,
  );
  const auth = paystackFetch.payload?.data?.authorization;
  const last4 = auth?.last4?.trim() ?? "";
  const brand = (auth?.brand ?? auth?.card_type ?? "").toString().trim();

  record(
    "1a Paystack subscription authorization (direct)",
    paystackFetch.response.ok &&
      paystackFetch.payload?.status === true &&
      Boolean(last4 || brand),
    last4
      ? `${brand || "card"} •••• ${last4} (exp ${auth?.exp_month}/${auth?.exp_year})`
      : `No authorization on subscription ${subscriptionCode}`,
  );

  const superCookie = await signInAndBuildCookieHeader(
    supabaseUrl,
    anonKey,
    "info@caanta.com",
    superAdminPassword,
  );

  const pmGet = await authedFetch(
    superCookie,
    "/api/billing/subscription/payment-method",
  );
  const pmBody = (await pmGet.json().catch(() => null)) as {
    error?: string;
    needs_checkout?: boolean;
    payment_method?: {
      last4?: string | null;
      brand?: string | null;
    } | null;
  } | null;

  const apiHasCard = Boolean(
    pmBody?.payment_method?.last4?.trim() || pmBody?.payment_method?.brand?.trim(),
  );
  record(
    "1b GET /api/billing/subscription/payment-method (super_admin)",
    pmGet.status === 200 && pmBody?.needs_checkout === false && apiHasCard,
    `status=${pmGet.status} last4=${pmBody?.payment_method?.last4 ?? "n/a"} brand=${pmBody?.payment_method?.brand ?? "n/a"}`,
  );

  // --- Step 2: manage-link redirect ---
  const manageDirect = await fetchManageLinkDirect(secretKey, subscriptionCode);
  const manageLink = manageDirect.payload?.data?.link?.trim() ?? "";
  record(
    "2a Paystack manage/link (direct)",
    manageDirect.response.ok &&
      manageDirect.payload?.status === true &&
      manageLink.includes("paystack.com"),
    manageLink ? manageLink.slice(0, 80) + "…" : manageDirect.payload?.message ?? "no link",
  );

  const managePost = await authedFetch(
    superCookie,
    "/api/billing/subscription/payment-method/manage-link",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const manageBody = (await managePost.json().catch(() => null)) as {
    link?: string;
    error?: string;
  } | null;
  const apiLink = manageBody?.link?.trim() ?? "";
  record(
    "2b POST manage-link API (super_admin)",
    managePost.status === 200 && apiLink.includes("paystack.com"),
    `status=${managePost.status} link=${apiLink ? "present" : manageBody?.error ?? "missing"}`,
  );

  // --- Step 3: trialing / no paystack subscription ---
  const { data: trialRows } = await admin
    .from("crm_subscriptions")
    .select("linked_tenant_id, subscription_status, paystack_subscription_id")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .in("subscription_status", ["trialing", "restricted"])
    .is("paystack_subscription_id", null)
    .limit(5);

  let trialTenantId = trialRows?.[0]?.linked_tenant_id ?? null;

  if (!trialTenantId) {
    const stamp = Date.now();
    const slug = `paymeth-trial-${stamp}`.slice(0, 63);
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .insert({ name: `PayMeth Trial ${stamp}`, slug, status: "active" })
      .select("id")
      .single();
    assert(!tenantError && tenant?.id, tenantError?.message ?? "trial tenant insert failed");
    trialTenantId = tenant.id as string;

    const clientId = `PAYMETH-${stamp}`.slice(0, 32);
    const { error: customerError } = await admin.from("customers").insert({
      tenant_id: DAVORS_TENANT_ID,
      client_id: clientId,
      client_name: `PayMeth Trial ${stamp}`,
      customer_type: "digital_subscriber",
      source: ERP_SUITE_SIGNUP_SOURCE,
      status: "lead",
    });
    assert(!customerError, customerError?.message ?? "trial customer insert failed");

    const { error: subInsertError } = await admin.from("crm_subscriptions").insert({
      tenant_id: DAVORS_TENANT_ID,
      customer_id: clientId,
      linked_tenant_id: trialTenantId,
      subscription_status: "trialing",
      paystack_subscription_id: null,
      billing_waived: true,
      trial_end_date: "2099-12-31T23:59:59Z",
    });
    assert(!subInsertError, subInsertError?.message ?? "trial sub insert failed");

    const trialEmail = `paymeth.trial.${stamp}@test.davors`;
    const trialPassword = "PayMethTrial-8Qx!";
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: trialEmail,
      password: trialPassword,
      email_confirm: true,
    });
    assert(!authError && authUser.user?.id, authError?.message ?? "trial auth create failed");

    const { error: accountError } = await admin.from("user_accounts").insert({
      auth_uid: authUser.user.id,
      tenant_id: trialTenantId,
      email: trialEmail,
      role: "super_admin",
      is_active: true,
    });
    assert(!accountError, accountError?.message ?? "trial account insert failed");

    const trialCookie = await signInAndBuildCookieHeader(
      supabaseUrl,
      anonKey,
      trialEmail,
      trialPassword,
    );

    const trialPmGet = await authedFetch(
      trialCookie,
      "/api/billing/subscription/payment-method",
    );
    const trialPmBody = (await trialPmGet.json().catch(() => null)) as {
      needs_checkout?: boolean;
      payment_method?: unknown;
    } | null;

    const trialManage = await authedFetch(
      trialCookie,
      "/api/billing/subscription/payment-method/manage-link",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );

    record(
      "3a GET payment-method (no paystack_subscription_id)",
      trialPmGet.status === 200 &&
        trialPmBody?.needs_checkout === true &&
        trialPmBody?.payment_method == null,
      `status=${trialPmGet.status} needs_checkout=${String(trialPmBody?.needs_checkout)}`,
    );
    record(
      "3b POST manage-link blocked (no subscription)",
      trialManage.status === 404,
      `status=${trialManage.status}`,
    );

    await admin.from("user_accounts").delete().eq("auth_uid", authUser.user!.id);
    await admin.auth.admin.deleteUser(authUser.user!.id);
    await admin
      .from("crm_subscriptions")
      .delete()
      .eq("linked_tenant_id", trialTenantId);
    await admin.from("customers").delete().eq("client_id", clientId);
    await admin.from("tenants").delete().eq("id", trialTenantId);
  } else {
    const { data: trialAdmin } = await admin
      .from("user_accounts")
      .select("email")
      .eq("tenant_id", trialTenantId)
      .eq("role", "super_admin")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!trialAdmin?.email) {
      record(
        "3 trialing tenant (skipped)",
        false,
        `Found trial tenant ${trialTenantId} but no super_admin email — set up manually`,
      );
    } else {
      const trialCookie = await signInAndBuildCookieHeader(
        supabaseUrl,
        anonKey,
        trialAdmin.email,
        superAdminPassword,
      );

      const trialPmGet = await authedFetch(
        trialCookie,
        "/api/billing/subscription/payment-method",
      );
      const trialPmBody = (await trialPmGet.json().catch(() => null)) as {
        needs_checkout?: boolean;
        payment_method?: unknown;
      } | null;

      const trialManage = await authedFetch(
        trialCookie,
        "/api/billing/subscription/payment-method/manage-link",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );

      record(
        "3a GET payment-method (no paystack_subscription_id)",
        trialPmGet.status === 200 &&
          trialPmBody?.needs_checkout === true &&
          trialPmBody?.payment_method == null,
        `tenant=${trialTenantId} status=${trialPmGet.status} needs_checkout=${String(trialPmBody?.needs_checkout)}`,
      );
      record(
        "3b POST manage-link blocked (no subscription)",
        trialManage.status === 404,
        `status=${trialManage.status}`,
      );
    }
  }

  // --- Step 4: non-super-admin → 403 ---
  const nonAdminStamp = Date.now();
  const nonAdminEmail = `paymeth.nonadmin.${nonAdminStamp}@test.davors`;
  const nonAdminPassword = "PayMethNonAdmin-8Qx!";
  const { data: nonAdminAuth, error: nonAdminAuthError } =
    await admin.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
  assert(
    !nonAdminAuthError && nonAdminAuth.user?.id,
    nonAdminAuthError?.message ?? "non-admin auth create failed",
  );

  const { error: nonAdminAccountError } = await admin.from("user_accounts").insert({
    auth_uid: nonAdminAuth.user!.id,
    tenant_id: CAANTA_TENANT_ID,
    email: nonAdminEmail,
    role: "finance",
    is_active: true,
  });
  assert(!nonAdminAccountError, nonAdminAccountError?.message ?? "non-admin account insert failed");

  const nonAdminCookie = await signInAndBuildCookieHeader(
    supabaseUrl,
    anonKey,
    nonAdminEmail,
    nonAdminPassword,
  );

  const forbiddenGet = await authedFetch(
    nonAdminCookie,
    "/api/billing/subscription/payment-method",
  );
  const forbiddenPost = await authedFetch(
    nonAdminCookie,
    "/api/billing/subscription/payment-method/manage-link",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );

  record(
    "4a Non-super-admin GET → 403",
    forbiddenGet.status === 403,
    `finance ${nonAdminEmail} status=${forbiddenGet.status}`,
  );
  record(
    "4b Non-super-admin POST → 403",
    forbiddenPost.status === 403,
    `finance ${nonAdminEmail} status=${forbiddenPost.status}`,
  );

  await admin.from("user_accounts").delete().eq("auth_uid", nonAdminAuth.user!.id);
  await admin.auth.admin.deleteUser(nonAdminAuth.user!.id);

  console.log("\n--- Summary ---");
  for (const row of results) {
    console.log(`${row.pass ? "✓" : "✗"} ${row.step}`);
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} step(s) failed — see output above`);
  }

  console.log("\nAll staging payment-method checks passed.");
  console.log(
    "\nNote: Step 2 full card replacement (hosted Paystack page + return) requires manual browser verification.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
