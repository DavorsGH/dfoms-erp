/**
 * Live staging E2E for landlord phases 2-3 (HTTP + optional browser follow-up).
 *
 *   npx tsx scripts/test-landlord-phases-2-3-e2e-staging-vercel.ts --env-file .env.staging.local
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");

const LANDLORD_PASSWORD = "LandlordP23-E2E-7Kx9!";

function resolveBypassSecret(): string {
  const existing = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (existing) return existing;

  const raw = execFileSync(
    "npx",
    ["vercel", "project", "protection", "dfoms-erp", "--json"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  const project = JSON.parse(raw.slice(raw.indexOf("{"))) as {
    protectionBypass?: Record<string, unknown>;
  };
  const secrets = Object.keys(project.protectionBypass ?? {});
  assert(secrets.length > 0, "No Vercel automation bypass secret");
  return secrets[0];
}

function bypassHeaders(bypass: string): Record<string, string> {
  return { "x-vercel-protection-bypass": bypass };
}

async function fetchResendInviteUrl(apiKey: string, toEmail: string) {
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
  assert(rows.length > 0, `No Resend emails for ${toEmail}`);

  for (const row of rows) {
    const detail = await fetch(`https://api.resend.com/emails/${row.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert(detail.ok, `Resend detail failed (${detail.status})`);
    const body = (await detail.json()) as { html?: string; text?: string };
    const content = body.html ?? body.text ?? "";
    const match = content.match(
      /https?:\/\/[^\s"']+\/landlord-portal\/accept-invite\?[^\s"']+/i,
    );
    if (match?.[0]) return match[0];
  }
  throw new Error(`No accept-invite link in Resend for ${toEmail}`);
}

function extractInviteToken(inviteUrl: string): string {
  const url = new URL(inviteUrl);
  const token = url.searchParams.get("token");
  assert(token, "Invite URL missing token");
  return token;
}

async function staffSessionCookies(
  admin: ReturnType<typeof createClient>,
  anon: ReturnType<typeof createClient>,
  staffEmail: string,
) {
  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: staffEmail,
    options: {
      redirectTo: `${STAGING_APP_URL}/dashboard/real-estate/landlords`,
    },
  });
  assert(!error && linkData?.properties?.hashed_token, error?.message ?? "generateLink failed");

  const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  assert(!verifyError && verifyData.session, verifyError?.message ?? "verifyOtp failed");

  const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      expires_at: verifyData.session.expires_at,
      expires_in: verifyData.session.expires_in,
      token_type: "bearer",
      user: verifyData.session.user,
    }),
  );

  return `${cookieName}=${cookieValue}`;
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    "";
  const resendKey = process.env.RESEND_API_KEY?.trim() ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Expected staging Supabase URL");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");
  assert(anonKey.length > 20, "Missing anon/publishable key");
  assert(resendKey, "RESEND_API_KEY required for invite check");

  const bypass = resolveBypassSecret();
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now();
  const landlordEmail = `landlord.phases23.${stamp}@test.davors`;
  const landlordName = `Phases 2-3 E2E ${stamp}`;
  const staffEmail = process.env.STAGING_STAFF_EMAIL?.trim() ?? "david.avors@gmail.com";

  let tenantId: string | null = null;
  let authUserId: string | null = null;

  console.log("=== Phases 2-3 live staging E2E ===\n");

  try {
    const cookieHeader = await staffSessionCookies(admin, anon, staffEmail);
    console.log("PASS — staff session established via magic-link OTP");

    const createResp = await fetch(`${STAGING_APP_URL}/api/admin/landlords/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        ...bypassHeaders(bypass),
      },
      body: JSON.stringify({
        name: landlordName,
        email: landlordEmail,
        phone: "+233200000099",
        address: "Phases 2-3 E2E Address, Accra",
      }),
    });
    const createBody = (await createResp.json().catch(() => null)) as {
      error?: string;
      tenant_id?: string;
      approval_status?: string;
    } | null;
    assert(createResp.ok && createBody?.tenant_id, createBody?.error ?? "create failed");
    tenantId = createBody.tenant_id;
    assert(
      createBody.approval_status === "approved",
      `Expected approved on create, got ${createBody.approval_status ?? "null"}`,
    );
    console.log("PASS — staff create API returns approved immediately");

    const { data: landlordRow } = await admin
      .from("landlords")
      .select("approval_status, auth_user_id")
      .eq("tenant_id", tenantId)
      .single();
    assert(landlordRow?.approval_status === "approved", "DB approval_status should be approved");
    assert(!landlordRow.auth_user_id, "No auth_user_id before invite accept");
    console.log("PASS — DB landlord approved, invite pending (no auth yet)");

    const inviteUrlRaw = await fetchResendInviteUrl(resendKey, landlordEmail);
    const inviteUrl = inviteUrlRaw.replace(
      /^https?:\/\/[^/]+/,
      STAGING_APP_URL,
    );
    console.log("PASS — portal invite email received from Resend");

    const listResp = await fetch(
      `${STAGING_APP_URL}/dashboard/real-estate/landlords`,
      {
        headers: { Cookie: cookieHeader, ...bypassHeaders(bypass) },
      },
    );
    const listHtml = await listResp.text();
    assert(listResp.ok, `Landlords page failed (${listResp.status})`);
    assert(listHtml.includes("Portal"), "Landlords list should include Portal column");
    assert(
      listHtml.includes("Approved · invite pending") ||
        listHtml.includes("Approved &middot; invite pending"),
      "List should show invite-pending portal status",
    );
    assert(
      !listHtml.includes("waiting for Davors staff review"),
      "Staff list must not show old pending-review copy",
    );
    console.log("PASS — staff list HTML shows Portal column + invite-pending status");

    const acceptResp = await fetch(`${STAGING_APP_URL}/api/landlord-portal/accept-invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...bypassHeaders(bypass),
      },
      body: JSON.stringify({
        token: extractInviteToken(inviteUrl),
        password: LANDLORD_PASSWORD,
      }),
    });
    const acceptBody = (await acceptResp.json().catch(() => null)) as {
      error?: string;
    } | null;
    assert(acceptResp.ok, acceptBody?.error ?? "accept invite failed");
    console.log("PASS — landlord accepted portal invite");

    const { data: linkedLandlord } = await admin
      .from("landlords")
      .select("auth_user_id, approval_status")
      .eq("tenant_id", tenantId)
      .single();
    authUserId = linkedLandlord?.auth_user_id ?? null;
    assert(authUserId, "auth_user_id should be set after invite accept");
    console.log("PASS — landlord auth account linked");

    const loginBefore = await anon.auth.signInWithPassword({
      email: landlordEmail,
      password: LANDLORD_PASSWORD,
    });
    assert(!loginBefore.error, loginBefore.error?.message ?? "login before suspend failed");
    await anon.auth.signOut();
    console.log("PASS — landlord login succeeds before suspend");

    const suspendResp = await fetch(`${STAGING_APP_URL}/api/admin/landlords/suspend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        ...bypassHeaders(bypass),
      },
      body: JSON.stringify({ tenant_id: tenantId }),
    });
    const suspendBody = (await suspendResp.json().catch(() => null)) as {
      error?: string;
      approval_status?: string;
    } | null;
    assert(suspendResp.ok, suspendBody?.error ?? "suspend failed");
    assert(suspendBody?.approval_status === "suspended", "suspend should return suspended");
    console.log("PASS — suspend API succeeded");

    const listAfterSuspend = await fetch(
      `${STAGING_APP_URL}/dashboard/real-estate/landlords`,
      { headers: { Cookie: cookieHeader, ...bypassHeaders(bypass) } },
    );
    const suspendHtml = await listAfterSuspend.text();
    assert(suspendHtml.includes("Suspended"), "Staff list should show Suspended portal status");
    console.log("PASS — staff list shows Suspended after suspend");

    const loginSuspended = await anon.auth.signInWithPassword({
      email: landlordEmail,
      password: LANDLORD_PASSWORD,
    });
    assert(loginSuspended.error, "Login should fail when suspended");
    const suspendedMsg = (loginSuspended.error?.message ?? "").toLowerCase();
    assert(
      suspendedMsg.includes("suspended") || suspendedMsg.includes("ban"),
      `Expected suspended/banned login error, got: ${loginSuspended.error?.message ?? ""}`,
    );
    console.log("PASS — landlord login blocked with suspended message");

    const approveResp = await fetch(`${STAGING_APP_URL}/api/admin/landlords/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        ...bypassHeaders(bypass),
      },
      body: JSON.stringify({ tenant_id: tenantId }),
    });
    const approveBody = (await approveResp.json().catch(() => null)) as {
      error?: string;
      approval_status?: string;
    } | null;
    assert(approveResp.ok, approveBody?.error ?? "reactivate approve failed");
    assert(approveBody?.approval_status === "approved", "reactivate should return approved");
    console.log("PASS — Approve override reactivated suspended landlord");

    const loginAfter = await anon.auth.signInWithPassword({
      email: landlordEmail,
      password: LANDLORD_PASSWORD,
    });
    assert(!loginAfter.error, loginAfter.error?.message ?? "login after reactivate failed");
    console.log("PASS — landlord login succeeds after reactivation");

    const inactiveResp = await fetch(`${STAGING_APP_URL}/landlord-portal/dashboard`, {
      headers: { ...bypassHeaders(bypass) },
      redirect: "manual",
    });
    const inactiveHtml = inactiveResp.ok ? await inactiveResp.text() : "";
    assert(
      !inactiveHtml.includes("waiting for Davors staff review"),
      "Landlord portal must not contain old staff-review copy",
    );
    console.log("PASS — deployed landlord portal HTML has no staff-review copy");

    console.log("\nAll phases 2-3 live staging E2E checks passed.");
  } finally {
    if (authUserId) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    }
    if (tenantId) {
      await admin.from("landlord_portal_invites").delete().eq("tenant_id", tenantId);
      await admin.from("landlord_subscriptions").delete().eq("tenant_id", tenantId);
      await admin.from("landlords").delete().eq("tenant_id", tenantId);
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    console.log("\nCleanup complete.");
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
