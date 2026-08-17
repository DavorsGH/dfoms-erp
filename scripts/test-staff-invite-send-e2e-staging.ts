/**
 * E2E staff invite send + accept on staging (service role).
 *
 *   npx tsx scripts/test-staff-invite-send-e2e-staging.ts --env-file .env.staging.local
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";
const CLIENT_ID = "CLI002";
const PASSWORD = "StaffInvite-E2E-8Qx!";
const stamp = Date.now().toString(36);

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function sendResend(to: string, inviteUrl: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false as const, error: "RESEND_API_KEY missing" };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Davors Facilities ERP <noreply@davorsfacilities.com>",
      to,
      subject: "You're invited to Davors Facilities ERP",
      html: `<p><a href="${inviteUrl}">Accept invite</a></p>`,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    return { ok: false as const, error: text || String(response.status) };
  }
  return { ok: true as const, id: text };
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const email = `staff-invite-e2e-${stamp}@test.davors`;
  const siteUrl =
    process.env.STAGING_APP_URL?.trim() ||
    "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";

  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

  const { data: invite, error: insertError } = await admin
    .from("staff_portal_invites")
    .insert({
      tenant_id: DAVORS_TENANT,
      email,
      token_hash: hashToken(rawToken),
      role: "client",
      employee_id: null,
      client_id: CLIENT_ID,
      expires_at: expiresAt,
    })
    .select("invite_id")
    .single();

  if (insertError || !invite) {
    throw new Error(insertError?.message ?? "invite insert failed");
  }

  const inviteUrl = `${siteUrl.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(rawToken)}`;
  console.log("Invite URL:", inviteUrl);

  const send = await sendResend(email, inviteUrl);
  console.log("Resend:", send.ok ? "sent" : send.error);
  if (!send.ok) {
    throw new Error(send.error);
  }

  const { data: authCreated, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { portal: "staff" },
    });
  if (authError || !authCreated.user) {
    throw new Error(authError?.message ?? "auth create failed");
  }

  const authUid = authCreated.user.id;
  const { error: uaError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    tenant_id: DAVORS_TENANT,
    role: "client",
    client_id: CLIENT_ID,
    email,
    is_active: true,
  });

  if (uaError) {
    await admin.auth.admin.deleteUser(authUid);
    throw new Error(uaError.message);
  }

  await admin
    .from("staff_portal_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("invite_id", invite.invite_id);

  console.log("Accept flow OK for", email, "auth_uid", authUid);

  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
  await admin.from("staff_portal_invites").delete().eq("invite_id", invite.invite_id);
  console.log("E2E cleanup done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
