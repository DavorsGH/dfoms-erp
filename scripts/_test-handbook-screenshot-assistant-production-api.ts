/**
 * Production live test: staff assistant returns DFOMS handbook answer + screenshot.
 *
 *   npx tsx scripts/_test-handbook-screenshot-assistant-production-api.ts --env-file .env.local.backup
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const QUERY = "how do I record a payment on a product sale";
const APP_URL = (
  process.env.APP_URL ?? process.env.PRODUCTION_APP_URL ?? "https://portal.davorsfacilities.com"
).replace(/\/$/, "");

async function createProbeStaffUser(url: string, serviceKey: string) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const email = `handbook-prod.${stamp}@test.davors`;
  const password = `HandbookProd-${stamp}!Aa8`;
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
      access_token: data.session!.access_token,
      refresh_token: data.session!.refresh_token,
      expires_at: data.session!.expires_at,
      expires_in: data.session!.expires_in,
      token_type: "bearer",
      user: data.session!.user,
    }),
  );
  return `${cookieName}=${cookieValue}`;
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(Boolean(supabaseUrl && anonKey && serviceKey), "Missing Supabase env");
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  assert(ref === PRODUCTION_REF, `Expected production ref ${PRODUCTION_REF}, got ${ref}`);

  const { email, password, authUid, admin } = await createProbeStaffUser(
    supabaseUrl,
    serviceKey,
  );

  try {
    const cookie = await signInCookie(supabaseUrl, anonKey, email, password);
    const response = await fetch(`${APP_URL}/api/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ message: QUERY }),
    });
    const payload = (await response.json()) as { reply?: string; error?: string };
    const reply = payload.reply ?? "";

    const hasDfomsTerms =
      /product sales|record payment|sales & crm/i.test(reply) &&
      !/coming soon|don't yet have access/i.test(reply);
    const hasProductSalesPath = /product sales register|record payment/i.test(reply);
    const hasScreenshot =
      reply.includes("handbook-screenshots") &&
      (reply.includes("7.2") || reply.includes("!["));

    console.log("\n=== Production assistant handbook test ===\n");
    console.log("APP_URL:", APP_URL);
    console.log("Status:", response.status);
    console.log("Reply preview:", reply.slice(0, 400).replace(/\n/g, " ") + "…");
    if (reply.includes("![")) {
      console.log("Screenshot tail:", reply.slice(reply.indexOf("![")).slice(0, 200));
    }
    console.log("DFOMS-specific answer:", hasDfomsTerms);
    console.log("Product Sales / Record Payment path:", hasProductSalesPath);
    console.log("Screenshot attached:", hasScreenshot);
    console.log(
      "PASS:",
      response.status === 200 && hasDfomsTerms && hasProductSalesPath && hasScreenshot,
    );

    if (response.status !== 200 || !hasDfomsTerms || !hasProductSalesPath || !hasScreenshot) {
      if (payload.error) console.log("Error:", payload.error);
      process.exit(1);
    }
  } finally {
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
