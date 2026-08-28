/**
 * Local accept-API + staging Auth login check (no Resend).
 * Requires next start on :3013 with staging Process env.
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
if (!url || !serviceKey || !anon) {
  throw new Error("Missing staging Supabase env");
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const stamp = Date.now().toString(36);
  const email = `fm.api.${stamp}@davors-staging-test.invalid`;
  const password = `FmApi!${stamp}Aa1`;

  const { data: landlords } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("approval_status", "approved")
    .limit(20);

  let tenantId: string | null = null;
  let propertyId: string | null = null;
  for (const row of landlords ?? []) {
    const { data: props } = await admin
      .from("properties")
      .select("property_id")
      .eq("tenant_id", row.tenant_id)
      .limit(1);
    if (props?.[0]) {
      tenantId = row.tenant_id as string;
      propertyId = props[0].property_id as string;
      break;
    }
  }
  if (!tenantId || !propertyId) throw new Error("no tenant/property");

  const now = new Date();
  const { data: fm, error: fmErr } = await admin
    .from("facility_managers")
    .insert({
      tenant_id: tenantId,
      full_name: `API FM ${stamp}`,
      email,
      status: "invited",
      invited_at: now.toISOString(),
    })
    .select("facility_manager_id")
    .single();
  if (fmErr || !fm) throw new Error(fmErr?.message ?? "fm insert failed");

  await admin.from("facility_manager_property_assignments").insert({
    tenant_id: tenantId,
    facility_manager_id: fm.facility_manager_id,
    property_id: propertyId,
  });

  const raw = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  const exp = new Date(now);
  exp.setDate(exp.getDate() + 7);
  await admin.from("facility_manager_portal_invites").insert({
    tenant_id: tenantId,
    facility_manager_id: fm.facility_manager_id,
    email,
    token_hash: hash,
    expires_at: exp.toISOString(),
  });

  const peek = await fetch(
    `http://localhost:3013/api/facility-portal/accept-invite?token=${encodeURIComponent(raw)}`,
  );
  const peekBody = await peek.json();
  console.log("PEEK", peek.status, peekBody);

  const accept = await fetch(
    "http://localhost:3013/api/facility-portal/accept-invite",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: raw, password }),
    },
  );
  const acceptBody = await accept.json();
  console.log("ACCEPT", accept.status, acceptBody);
  if (!accept.ok) process.exit(1);

  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signed, error: signErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr || !signed.user) throw new Error(signErr?.message ?? "login failed");

  const { data: active } = await admin
    .from("facility_managers")
    .select("status, full_name")
    .eq("auth_user_id", signed.user.id)
    .eq("status", "active")
    .maybeSingle();

  console.log("LOGIN_OK", {
    email,
    fullName: active?.full_name,
    status: active?.status,
    portal: signed.user.user_metadata?.portal,
  });
}

main().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
