/**
 * E2E via chat API: staff reply includes handbook screenshot markdown after text.
 *
 * Local dev:
 *   APP_URL=http://localhost:3000 npx tsx scripts/_test-handbook-screenshot-assistant-staging-api.ts --env-file .env.staging.local
 *
 * Staging Vercel (after deploy):
 *   npx tsx scripts/_test-handbook-screenshot-assistant-staging-api.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const QUERIES = [
  "how do I record a payment on a product sale",
  "how do quotations work",
] as const;

function appBase(): string {
  return (
    process.env.APP_URL ??
    process.env.STAGING_APP_URL ??
    "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
  ).replace(/\/$/, "");
}

function bypassHeaders(): Record<string, string> {
  const base = appBase();
  if (!base.includes("vercel.app")) return {};
  const bypass =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ??
    "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
  return { "x-vercel-protection-bypass": bypass };
}

async function signInCookie(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string> {
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  assert(!error && data.session, `sign-in failed: ${error?.message}`);

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

async function createProbeStaffUser(url: string, serviceKey: string) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const email = `handbook-shot.${stamp}@test.davors`;
  const password = `HandbookShot-${stamp}!Aa8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  assert(!error && data.user, error?.message ?? "createUser failed");
  const authUid = data.user!.id;
  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    role: "super_admin",
    is_active: true,
    tenant_id: DAVORS_TENANT_ID,
  });
  if (accountError) {
    await admin.auth.admin.deleteUser(authUid);
    throw new Error(accountError.message);
  }
  return { email, password, authUid, admin };
}

async function askAssistant(cookie: string, message: string) {
  const response = await fetch(`${appBase()}/api/assistant/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...bypassHeaders(),
    },
    body: JSON.stringify({ message }),
  });
  const payload = (await response.json()) as { reply?: string; error?: string };
  return { status: response.status, payload };
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(Boolean(supabaseUrl && anonKey && serviceKey), "Missing Supabase env");

  const { email, password, authUid, admin } = await createProbeStaffUser(
    supabaseUrl,
    serviceKey,
  );

  try {
    const cookie = await signInCookie(supabaseUrl, anonKey, email, password);
    console.log("\n=== Assistant handbook screenshot API E2E ===\n");
    console.log("APP_URL:", appBase());

    let allPass = true;
    for (const query of QUERIES) {
      const { status, payload } = await askAssistant(cookie, query);
      const reply = payload.reply ?? "";
      const hasImage =
        reply.includes("![") &&
        reply.includes("handbook-screenshots") &&
        reply.includes("](http");
      const imageAfterText =
        hasImage &&
        reply.indexOf("![") > 0 &&
        reply.slice(0, reply.indexOf("![")).trim().length > 20;

      const pass = status === 200 && imageAfterText;
      allPass &&= pass;

      console.log(`\nQuery: ${query}`);
      console.log(`Status: ${status}`);
      console.log(`Reply preview: ${reply.slice(0, 180).replace(/\n/g, " ")}…`);
      console.log(`Screenshot appended: ${hasImage}`);
      console.log(`PASS: ${pass}`);
      if (!pass && payload.error) console.log(`Error: ${payload.error}`);
    }

    if (!allPass) process.exit(1);
  } finally {
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
