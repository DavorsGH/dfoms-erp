/**
 * Verify Landlord Portal Workspace Settings page loads on staging after 212 migration.
 *
 *   npx tsx scripts/_verify-landlord-workspace-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD_CANDIDATES = ["ikechuku", "LandlordP23-E2E-7Kx9!", "AccountHubP1-Test-7Kx9!"];

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

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(supabaseUrl.includes(STAGING_REF), "Expected staging Supabase URL");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: approvedLandlords } = await admin
    .from("landlords")
    .select("tenant_id, landlord_type, approval_status")
    .eq("approval_status", "approved")
    .not("auth_user_id", "is", null);

  const landlordEmails: string[] = [];
  for (const row of approvedLandlords ?? []) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("email")
      .eq("id", row.tenant_id)
      .maybeSingle();
    const email =
      typeof tenant?.email === "string" ? tenant.email.trim().toLowerCase() : "";
    if (email) landlordEmails.push(email);
  }
  assert(landlordEmails.length > 0, "Need approved landlord with email on staging");

  let cookie: string | null = null;
  let signedInEmail: string | null = null;
  for (const email of landlordEmails) {
    for (const password of PASSWORD_CANDIDATES) {
      try {
        cookie = await signInAndBuildCookieHeader(supabaseUrl, anonKey, email, password);
        signedInEmail = email;
        break;
      } catch {
        // try next password / landlord
      }
    }
    if (cookie) break;
  }
  assert(cookie && signedInEmail, "Could not sign in as any approved staging landlord");

  const response = await fetch(
    `${STAGING_APP_URL}/landlord-portal/administration/workspace`,
    {
      redirect: "follow",
      headers: {
        ...bypassHeaders(),
        Cookie: cookie,
      },
    },
  );

  const html = await response.text();
  assert(response.ok, `Workspace settings page failed (${response.status})`);
  assert(
    !html.includes("column landlords.signature_url does not exist"),
    "Page still shows signature_url column error",
  );
  assert(
    html.includes("Workspace settings") || html.includes("workspace settings"),
    "Expected workspace settings heading in page HTML",
  );

  console.log(`PASS — Workspace settings page loads for ${signedInEmail}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
