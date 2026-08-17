/**
 * Phase 1 account hub staging regression (tenant + landlord portals).
 *
 *   npx tsx scripts/test-account-hub-phase1-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  createTestPendingLandlord,
} from "./lib/landlord-test-helpers";

const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TEST_PASSWORD = "AccountHubP1-Test-7Kx9!";

function bypassHeaders(): Record<string, string> {
  const bypass =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ??
    "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
  return { "x-vercel-protection-bypass": bypass };
}

async function signInAndBuildCookieHeader(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string> {
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  assert(!error && data.session, `sign-in failed for ${email}: ${error?.message}`);

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      expires_in: data.session.expires_in,
      token_type: "bearer",
      user: data.session.user,
    }),
  );

  return `${cookieName}=${cookieValue}`;
}

async function fetchPath(
  path: string,
  cookieHeader?: string,
  redirect: RequestRedirect = "manual",
): Promise<Response> {
  return fetch(`${STAGING_APP_URL}${path}`, {
    redirect,
    headers: {
      ...bypassHeaders(),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
}

async function fetchPathFinalUrl(
  path: string,
  cookieHeader?: string,
): Promise<{ response: Response; finalUrl: string }> {
  const response = await fetch(`${STAGING_APP_URL}${path}`, {
    redirect: "follow",
    headers: {
      ...bypassHeaders(),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
  return { response, finalUrl: response.url };
}

function assertPageReachable(options: {
  response: Response;
  finalUrl: string;
  expectedPathSuffix: string;
  label: string;
}) {
  assert(options.response.ok, `${options.label} (${options.response.status})`);
  assert(
    options.finalUrl.includes(options.expectedPathSuffix),
    `${options.label} should stay on ${options.expectedPathSuffix} (got ${options.finalUrl})`,
  );
  console.log(`PASS — ${options.label}`);
}

async function assertRedirect(from: string, to: string, cookieHeader?: string) {
  const manual = await fetchPath(from, cookieHeader, "manual");
  const location = manual.headers.get("location") ?? "";
  if (manual.status >= 300 && manual.status < 400 && location.includes(to)) {
    console.log(`PASS — redirect ${from} → ${to}`);
    return;
  }

  const response = await fetchPath(from, cookieHeader, "follow");
  assert(
    response.url.includes(to),
    `${from} should redirect to ${to} (got ${response.url}, status ${manual.status}, location ${location})`,
  );
  console.log(`PASS — redirect ${from} → ${to}`);
}

async function cleanupPendingLandlord(
  admin: ReturnType<typeof createClient>,
  tenantId: string | null,
  authUserId: string | null,
) {
  if (authUserId) {
    await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
  }
  if (tenantId) {
    await admin.from("landlords").delete().eq("tenant_id", tenantId);
    await admin.from("tenants").delete().eq("id", tenantId);
  }
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    "";
  assert(url.includes(STAGING_REF), "Expected staging Supabase URL");
  assert(serviceKey && anonKey.length > 20, "Missing Supabase keys");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("=== Account hub Phase 1 (staging) ===\n");

  const unauthTenant = await fetchPath("/portal/account");
  assert(
    unauthTenant.status === 307 || unauthTenant.status === 308,
    `/portal/account unauthenticated should redirect (got ${unauthTenant.status})`,
  );
  console.log("PASS — unauthenticated /portal/account redirects to login");

  const unauthLandlord = await fetchPath("/landlord-portal/account");
  assert(
    unauthLandlord.status === 307 || unauthLandlord.status === 308,
    `/landlord-portal/account unauthenticated should redirect (got ${unauthLandlord.status})`,
  );
  console.log(
    "PASS — unauthenticated /landlord-portal/account redirects to login",
  );

  const stamp = Date.now();
  const pendingEmail = `landlord.account.p1.${stamp}@test.davors`;
  let pendingTenantId: string | null = null;
  let pendingAuthUserId: string | null = null;

  try {
    pendingTenantId = await createTestPendingLandlord(admin, {
      name: `Account Hub Pending ${stamp}`,
      email: pendingEmail,
      phone: "+233200000111",
      address: "Test Address",
    });

    const { data: authCreated, error: authError } =
      await admin.auth.admin.createUser({
        email: pendingEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: `Account Hub Pending ${stamp}`,
          portal: "landlord",
        },
      });
    assert(!authError && authCreated.user, authError?.message ?? "auth create failed");
    pendingAuthUserId = authCreated.user.id;

    const { error: linkError } = await admin.from("landlords").update({
      auth_user_id: pendingAuthUserId,
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", pendingTenantId);
    assert(!linkError, linkError?.message ?? "landlord auth link failed");

    const pendingCookie = await signInAndBuildCookieHeader(
      url,
      anonKey,
      pendingEmail,
      TEST_PASSWORD,
    );

    const pendingAccount = await fetchPathFinalUrl(
      "/landlord-portal/account",
      pendingCookie,
    );
    assertPageReachable({
      response: pendingAccount.response,
      finalUrl: pendingAccount.finalUrl,
      expectedPathSuffix: "/landlord-portal/account",
      label: "pending landlord reaches /landlord-portal/account hub",
    });

    const pendingMfa = await fetchPathFinalUrl(
      "/landlord-portal/account/mfa",
      pendingCookie,
    );
    assertPageReachable({
      response: pendingMfa.response,
      finalUrl: pendingMfa.finalUrl,
      expectedPathSuffix: "/landlord-portal/account/mfa",
      label: "pending landlord reaches /landlord-portal/account/mfa",
    });

    await assertRedirect(
      "/landlord-portal/administration/account-security",
      "/landlord-portal/account",
      pendingCookie,
    );
    await assertRedirect(
      "/landlord-portal/administration/account-security/mfa",
      "/landlord-portal/account/mfa",
      pendingCookie,
    );
  } finally {
    await cleanupPendingLandlord(admin, pendingTenantId, pendingAuthUserId);
  }

  const { data: approvedLandlords } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id, landlord_type, approval_status")
    .eq("approval_status", "approved")
    .not("auth_user_id", "is", null);

  let davorsManagedEmail: string | null = null;
  let platformOnlyEmail: string | null = null;

  for (const row of approvedLandlords ?? []) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("email")
      .eq("id", row.tenant_id)
      .maybeSingle();
    const email =
      typeof tenant?.email === "string" ? tenant.email.trim().toLowerCase() : "";
    if (!email) continue;

    if (row.landlord_type === "davors_managed" && !davorsManagedEmail) {
      davorsManagedEmail = email;
    }
    if (row.landlord_type === "platform_only" && !platformOnlyEmail) {
      platformOnlyEmail = email;
    }
  }

  for (const [label, email] of [
    ["davors_managed", davorsManagedEmail],
    ["platform_only", platformOnlyEmail],
  ] as const) {
    if (!email) {
      console.log(`SKIP — no approved ${label} landlord with email on staging`);
      continue;
    }

    const cookie = await signInAndBuildCookieHeader(url, anonKey, email, "ikechuku");
    const account = await fetchPathFinalUrl("/landlord-portal/account", cookie);
    assertPageReachable({
      response: account.response,
      finalUrl: account.finalUrl,
      expectedPathSuffix: "/landlord-portal/account",
      label: `approved ${label} landlord account hub renders`,
    });
  }

  const { data: lesseeRow } = await admin
    .from("lessees")
    .select("auth_user_id, email, tenant_id")
    .not("auth_user_id", "is", null)
    .limit(20);

  let lesseeEmail: string | null = null;
  for (const row of lesseeRow ?? []) {
    if (typeof row.email === "string" && row.email.includes("@")) {
      lesseeEmail = row.email.trim().toLowerCase();
      break;
    }
    const { data: authUser } = await admin.auth.admin.getUserById(row.auth_user_id!);
    const email = authUser.user?.email?.trim().toLowerCase();
    if (email) {
      lesseeEmail = email;
      break;
    }
  }

  if (lesseeEmail) {
    const lesseeCookie = await signInAndBuildCookieHeader(
      url,
      anonKey,
      lesseeEmail,
      "ikechuku",
    );
    const tenantAccount = await fetchPathFinalUrl("/portal/account", lesseeCookie);
    assertPageReachable({
      response: tenantAccount.response,
      finalUrl: tenantAccount.finalUrl,
      expectedPathSuffix: "/portal/account",
      label: `tenant account hub renders (${lesseeEmail})`,
    });

    const tenantMfa = await fetchPathFinalUrl("/portal/account/mfa", lesseeCookie);
    assertPageReachable({
      response: tenantMfa.response,
      finalUrl: tenantMfa.finalUrl,
      expectedPathSuffix: "/portal/account/mfa",
      label: "tenant MFA page renders inside portal shell",
    });

    await assertRedirect("/portal/account-security", "/portal/account", lesseeCookie);
    await assertRedirect("/portal/account-security/mfa", "/portal/account/mfa", lesseeCookie);
  } else {
    console.log("SKIP — no lessee with auth email on staging");
  }

  console.log("\nAll account hub Phase 1 staging checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
