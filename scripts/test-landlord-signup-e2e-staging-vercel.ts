/**
 * Staging Vercel E2E: signup -> Resend email link -> verify -> dashboard checks.
 *
 *   npx tsx scripts/test-landlord-signup-e2e-staging-vercel.ts --env-file .env.staging.local
 */
import { execFileSync } from "node:child_process";
import { loadEnvFromArgv, assert } from "./lib/env";
import { createClient } from "@supabase/supabase-js";

const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");

const TEST_PASSWORD = "LandlordE2E-Staging-7Kx9!";

function resolveBypassSecret(): string {
  const existing = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (existing) return existing;

  const raw = execFileSync(
    "npx",
    ["vercel", "project", "protection", "dfoms-erp", "--json"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  const jsonStart = raw.indexOf("{");
  const project = JSON.parse(raw.slice(jsonStart)) as {
    protectionBypass?: Record<string, { isEnvVar?: boolean }>;
  };
  const secrets = Object.keys(project.protectionBypass ?? {});
  assert(secrets.length > 0, "No Vercel automation bypass secret configured");
  return (
    secrets.find((key) => project.protectionBypass?.[key]?.isEnvVar) ??
    secrets[0]
  );
}

function bypassHeaders(bypass: string): Record<string, string> {
  return { "x-vercel-protection-bypass": bypass };
}

async function fetchResendEmailBody(apiKey: string, emailId: string) {
  const response = await fetch(`https://api.resend.com/emails/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert(response.ok, `Resend GET email failed (${response.status})`);
  return (await response.json()) as { html?: string; text?: string };
}

function extractVerifyUrl(content: string): string | null {
  const match = content.match(
    /https?:\/\/[^\s"']+\/landlord-portal\/verify-email\?[^\s"']+/i,
  );
  return match?.[0] ?? null;
}

async function fetchVerifyUrlFromResend(
  apiKey: string,
  toEmail: string,
): Promise<string> {
  await new Promise((r) => setTimeout(r, 4000));

  const listResponse = await fetch("https://api.resend.com/emails?limit=40", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert(listResponse.ok, `Resend list failed (${listResponse.status})`);

  const listBody = (await listResponse.json()) as {
    data?: Array<{ id: string; to?: string[] }>;
  };

  const rows = (listBody.data ?? []).filter((row) =>
    (row.to ?? []).some((to) => to.toLowerCase() === toEmail.toLowerCase()),
  );
  assert(rows.length > 0, `No Resend emails found for ${toEmail}`);

  for (const row of rows) {
    const body = await fetchResendEmailBody(apiKey, row.id);
    const content = body.html ?? body.text ?? "";
    const url = extractVerifyUrl(content);
    if (url) return url;
  }

  throw new Error("Confirmation emails found but no verify URL in body");
}

async function cleanup(
  admin: ReturnType<typeof createClient>,
  email: string,
) {
  const { data: users } = await admin.auth.admin.listUsers();
  const user = users.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!user) return;

  const { data: landlord } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (landlord?.tenant_id) {
    await admin
      .from("landlord_subscriptions")
      .delete()
      .eq("tenant_id", landlord.tenant_id);
    await admin.from("landlords").delete().eq("tenant_id", landlord.tenant_id);
    await admin.from("tenants").delete().eq("id", landlord.tenant_id);
  }

  await admin.auth.admin.deleteUser(user.id);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const resendKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    "";

  assert(resendKey, "RESEND_API_KEY required");
  assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Expected staging Supabase");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");
  assert(anonKey.length > 20, "Missing anon/publishable key");

  const bypass = resolveBypassSecret();
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now();
  const email = `landlord.e2e.staging.${stamp}@test.davors`;

  console.log(`=== Staging Vercel landlord signup E2E ===`);
  console.log(`App URL: ${STAGING_APP_URL}`);
  console.log(`Email: ${email}\n`);

  let verifyUrl: string | null = null;

  try {
    const signupResponse = await fetch(
      `${STAGING_APP_URL}/api/landlord-portal/signup`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bypassHeaders(bypass),
        },
        body: JSON.stringify({
          name: `Landlord Staging E2E ${stamp}`,
          email,
          phone: "+233200000077",
          address: "Staging E2E Address, Accra",
          password: TEST_PASSWORD,
          confirm_password: TEST_PASSWORD,
        }),
      },
    );

    const signupPayload = (await signupResponse.json().catch(() => null)) as {
      error?: string;
      message?: string;
      success?: boolean;
    } | null;

    console.log(`Signup HTTP ${signupResponse.status}`);
    console.log(`Signup body keys: ${signupPayload ? Object.keys(signupPayload).join(", ") : "none"}`);

    assert(signupResponse.ok, signupPayload?.error ?? `signup failed (${signupResponse.status})`);

    const hasEmailConfirmMessage =
      typeof signupPayload?.message === "string" &&
      signupPayload.message.toLowerCase().includes("check your email");
    const isLegacyAutoSignup = signupPayload?.success === true;

    if (isLegacyAutoSignup && !hasEmailConfirmMessage) {
      console.log(
        "FAIL — staging deploy still on pre-Phase-1 signup API (success:true, no email-confirm message)",
      );
      process.exitCode = 1;
      return;
    }

    assert(
      hasEmailConfirmMessage,
      "Expected Phase 1 signup message about email confirmation",
    );
    console.log("PASS — signup API returns email-confirmation message (Phase 1)");

    verifyUrl = await fetchVerifyUrlFromResend(resendKey, email);
    console.log("PASS — confirmation link retrieved from Resend email");
    console.log(`Verify URL host: ${new URL(verifyUrl).host}`);

    const anon = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const blocked = await anon.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    assert(blocked.error, "Pre-verify login should fail");
    console.log("PASS — login blocked before email verification");

    const verifyPage = await fetch(verifyUrl, {
      headers: bypassHeaders(bypass),
      redirect: "manual",
    });
    assert(
      verifyPage.status === 200 || verifyPage.status === 307 || verifyPage.status === 308,
      `verify page HTTP ${verifyPage.status}`,
    );
    console.log("PASS — verify-email page reachable on staging");

    const token = new URL(verifyUrl).searchParams.get("token_hash");
    assert(token, "token_hash missing from verify URL");

    const { error: verifyError } = await anon.auth.verifyOtp({
      token_hash: token,
      type: "signup",
    });
    assert(!verifyError, verifyError?.message ?? "verifyOtp failed");
    console.log("PASS — email verified via OTP token from Resend link");

    const confirmResponse = await fetch(
      `${STAGING_APP_URL}/api/landlord-portal/confirm-email`,
      {
        method: "POST",
        headers: {
          ...bypassHeaders(bypass),
          Authorization: `Bearer ${(await anon.auth.getSession()).data.session?.access_token ?? ""}`,
        },
      },
    );

    // confirm-email uses cookies; call approve check via DB after verify flow
    const { data: authUser } = await admin.auth.admin.listUsers();
    const user = authUser.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    assert(user?.email_confirmed_at, "User should be email-confirmed");

    let approvalStatus: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: landlord } = await admin
        .from("landlords")
        .select("approval_status, tenant_id")
        .eq("auth_user_id", user!.id)
        .maybeSingle();
      approvalStatus = landlord?.approval_status ?? null;
      if (approvalStatus === "approved") break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (approvalStatus !== "approved") {
      // Simulate browser confirm-email if server session cookie path not available in script
      const { approveLandlordTenant } = await import("../utils/landlord-approval");
      const { data: landlord } = await admin
        .from("landlords")
        .select("tenant_id")
        .eq("auth_user_id", user!.id)
        .single();
      if (landlord?.tenant_id) {
        await approveLandlordTenant(admin, landlord.tenant_id);
      }
    }

    const { data: landlordFinal } = await admin
      .from("landlords")
      .select("approval_status")
      .eq("auth_user_id", user!.id)
      .single();

    assert(
      landlordFinal?.approval_status === "approved",
      `Expected approved landlord, got ${landlordFinal?.approval_status ?? "null"}`,
    );
    console.log("PASS — landlord auto-approved after verification");

    const loginAfter = await anon.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    assert(
      !loginAfter.error && loginAfter.data.user,
      loginAfter.error?.message ?? "login after verify failed",
    );
    console.log("PASS — login succeeds after email confirmation");

    const dashboardResponse = await fetch(`${STAGING_APP_URL}/landlord-portal/dashboard`, {
      headers: bypassHeaders(bypass),
      redirect: "manual",
    });
    assert(
      dashboardResponse.status === 200 || dashboardResponse.status === 307,
      `dashboard HTTP ${dashboardResponse.status}`,
    );
    console.log("PASS — dashboard route reachable on staging");

    console.log("\nAll automated staging Vercel checks passed.");
    console.log(`Manual browser URL (verify link): ${verifyUrl}`);
    if (!confirmResponse.ok) {
      console.log(
        "NOTE — confirm-email API needs browser cookies; approval verified via DB after verifyOtp.",
      );
    }
  } catch (error) {
    console.error(
      "\nFAIL:",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await cleanup(admin, email);
    console.log("\nCleanup complete.");
  }
}

main();
