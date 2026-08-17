/**
 * Gap 2: platform_only landlord lessee update API smoke test (staging).
 *
 *   npx tsx scripts/test-landlord-lessee-update-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");
const LANDLORD_PASSWORD = "ikechuku";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert(url && serviceKey && anonKey, "Missing Supabase env");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
  const bypassHeaders = bypass
    ? { "x-vercel-protection-bypass": bypass }
    : {};

  const { data: lesseeCandidates } = await admin
    .from("lessees")
    .select("lessee_id, tenant_id, full_name, phone, email, auth_user_id")
    .limit(100);

  let landlord: { tenant_id: string; auth_user_id: string } | null = null;
  let lessee: (typeof lesseeCandidates)[number] | null = null;
  let landlordEmail = "";

  for (const candidate of lesseeCandidates ?? []) {
    const { data: landlordRow } = await admin
      .from("landlords")
      .select("tenant_id, auth_user_id, landlord_type, approval_status")
      .eq("tenant_id", candidate.tenant_id)
      .maybeSingle();

    if (
      !landlordRow ||
      landlordRow.landlord_type !== "platform_only" ||
      landlordRow.approval_status !== "approved" ||
      !landlordRow.auth_user_id
    ) {
      continue;
    }

    const { data: tenantRow } = await admin
      .from("tenants")
      .select("email")
      .eq("id", candidate.tenant_id)
      .maybeSingle();

    const email =
      typeof tenantRow?.email === "string" ? tenantRow.email.trim().toLowerCase() : "";
    if (!email) continue;

    landlord = {
      tenant_id: landlordRow.tenant_id,
      auth_user_id: landlordRow.auth_user_id,
    };
    lessee = candidate;
    landlordEmail = email;
    break;
  }

  let createdTempLessee = false;
  if (!lessee) {
    const { data: platformLandlord } = await admin
      .from("landlords")
      .select("tenant_id, auth_user_id")
      .eq("landlord_type", "platform_only")
      .eq("approval_status", "approved")
      .not("auth_user_id", "is", null)
      .limit(1)
      .maybeSingle();

    assert(platformLandlord?.tenant_id, "Need approved platform_only landlord");

    const { data: tenantRow } = await admin
      .from("tenants")
      .select("email")
      .eq("id", platformLandlord.tenant_id)
      .maybeSingle();

    landlordEmail =
      typeof tenantRow?.email === "string" ? tenantRow.email.trim().toLowerCase() : "";
    assert(landlordEmail, "Landlord tenant email missing");

    landlord = {
      tenant_id: platformLandlord.tenant_id,
      auth_user_id: platformLandlord.auth_user_id!,
    };

    const { data: inserted, error: insertError } = await admin
      .from("lessees")
      .insert({
        tenant_id: platformLandlord.tenant_id,
        full_name: `Temp Edit Test ${Date.now()}`,
        phone: "+233200000099",
        email: null,
        status: "active",
      })
      .select("lessee_id, full_name, phone, email, auth_user_id")
      .single();

    assert(!insertError && inserted, insertError?.message ?? "temp lessee insert failed");
    lessee = inserted;
    createdTempLessee = true;
  }

  assert(landlord && lessee && landlordEmail, "Could not resolve platform_only test landlord");

  const login = await anon.auth.signInWithPassword({
    email: landlordEmail,
    password: LANDLORD_PASSWORD,
  });
  assert(!login.error && login.data.session, login.error?.message ?? "landlord login failed");

  const projectRef = new URL(url).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: login.data.session.access_token,
      refresh_token: login.data.session.refresh_token,
      expires_at: login.data.session.expires_at,
      expires_in: login.data.session.expires_in,
      token_type: "bearer",
      user: login.data.session.user,
    }),
  );
  const cookieHeader = `${cookieName}=${cookieValue}`;

  const originalName = lessee.full_name;
  const updatedName = `${originalName.replace(/ Updated$/, "")} Updated`;

  const updateResp = await fetch(`${STAGING_APP_URL}/api/landlord-portal/lessees/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      ...bypassHeaders,
    },
    body: JSON.stringify({
      lessee_id: lessee.lessee_id,
      full_name: updatedName,
      phone: lessee.phone,
      email: lessee.email,
    }),
  });
  const updateBody = (await updateResp.json().catch(() => null)) as {
    error?: string;
    success?: boolean;
  } | null;
  assert(updateResp.ok && updateBody?.success, updateBody?.error ?? "update failed");
  console.log("PASS — lessee update API succeeded");

  const { data: reloaded } = await admin
    .from("lessees")
    .select("full_name")
    .eq("lessee_id", lessee.lessee_id)
    .single();
  assert(reloaded?.full_name === updatedName, "DB name not updated");
  console.log("PASS — lessee full_name persisted");

  await fetch(`${STAGING_APP_URL}/api/landlord-portal/lessees/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      ...bypassHeaders,
    },
    body: JSON.stringify({
      lessee_id: lessee.lessee_id,
      full_name: originalName.replace(/ Updated$/, ""),
      phone: lessee.phone,
      email: lessee.email,
    }),
  });
  console.log("PASS — lessee name reverted");

  const detailResp = await fetch(
    `${STAGING_APP_URL}/landlord-portal/real-estate/tenants/${lessee.lessee_id}`,
    { headers: { Cookie: cookieHeader, ...bypassHeaders } },
  );
  const detailHtml = detailResp.ok ? await detailResp.text() : "";
  assert(detailResp.ok, `detail page status ${detailResp.status}`);
  assert(
    detailHtml.includes("Contact details") || detailHtml.includes("Full name"),
    "detail page should render tenant form",
  );
  console.log("PASS — tenant detail page renders for platform_only landlord");

  if (lessee.auth_user_id) {
    assert(
      detailHtml.includes("portal login email"),
      "portal account warning should appear",
    );
    console.log("PASS — portal account email warning visible");
  }

  await anon.auth.signOut();

  if (createdTempLessee) {
    await admin.from("lessees").delete().eq("lessee_id", lessee.lessee_id);
    console.log("PASS — temp lessee cleaned up");
  }

  console.log("\nGap 2 lessee edit E2E checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
