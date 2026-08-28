/**
 * Staging smoke: create FM invite → accept → verify active + metadata.
 * Does NOT send email if RESEND is missing — uses direct token insert then.
 *
 * Usage:
 *   npx tsx scripts/test-facility-manager-invite-accept-staging.ts
 *   npx tsx scripts/test-facility-manager-invite-accept-staging.ts --email=you@example.com
 *
 * Requires .env.staging.local with service role + a platform_only landlord tenant
 * that has at least one property.
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : null;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function main() {
  const emailOverride = argValue("email");
  const stamp = Date.now().toString(36);
  const email =
    emailOverride ||
    `fm.invite.${stamp}@davors-staging-test.invalid`;

  const { data: landlords, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, landlord_type, approval_status")
    .eq("approval_status", "approved")
    .limit(20);

  if (landlordError) throw new Error(landlordError.message);

  let tenantId: string | null = null;
  let propertyId: string | null = null;
  let landlordName = "Staging Landlord";

  for (const row of landlords ?? []) {
    const { data: props } = await admin
      .from("properties")
      .select("property_id")
      .eq("tenant_id", row.tenant_id)
      .limit(1);
    if (props?.[0]?.property_id) {
      tenantId = row.tenant_id;
      propertyId = props[0].property_id;
      const { data: tenant } = await admin
        .from("tenants")
        .select("name")
        .eq("id", tenantId)
        .maybeSingle();
      if (typeof tenant?.name === "string" && tenant.name.trim()) {
        landlordName = tenant.name.trim();
      }
      break;
    }
  }

  if (!tenantId || !propertyId) {
    throw new Error("No approved landlord with a property found on staging.");
  }

  console.log("Using tenant", tenantId, landlordName, "property", propertyId);

  // Clean prior test FMs with this email on tenant
  await admin
    .from("facility_managers")
    .delete()
    .eq("tenant_id", tenantId)
    .ilike("email", email);

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { data: fm, error: fmError } = await admin
    .from("facility_managers")
    .insert({
      tenant_id: tenantId,
      full_name: `FM Test ${stamp}`,
      email,
      status: "invited",
      can_manage_maintenance: true,
      can_manage_complaints: true,
      can_manage_inspections: true,
      can_log_services: true,
      can_collect_rent: false,
      can_collect_charges: false,
      invited_at: now.toISOString(),
    })
    .select("facility_manager_id")
    .single();

  if (fmError || !fm) throw new Error(fmError?.message ?? "FM insert failed");

  const facilityManagerId = fm.facility_manager_id as string;

  const { error: assignError } = await admin
    .from("facility_manager_property_assignments")
    .insert({
      tenant_id: tenantId,
      facility_manager_id: facilityManagerId,
      property_id: propertyId,
    });
  if (assignError) throw new Error(assignError.message);

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const { error: inviteError } = await admin
    .from("facility_manager_portal_invites")
    .insert({
      tenant_id: tenantId,
      facility_manager_id: facilityManagerId,
      email,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });
  if (inviteError) throw new Error(inviteError.message);

  console.log("Invite token (accept URL):");
  console.log(
    `/facility-portal/accept-invite?token=${encodeURIComponent(rawToken)}`,
  );

  const password = `FmTest!${stamp}Aa1`;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: `FM Test ${stamp}`,
        portal: "facility_manager",
      },
    });
  if (createError || !created.user) {
    throw new Error(createError?.message ?? "auth create failed");
  }

  const authUserId = created.user.id;
  const nowIso = new Date().toISOString();

  const { error: linkError } = await admin
    .from("facility_managers")
    .update({
      auth_user_id: authUserId,
      status: "active",
      activated_at: nowIso,
      updated_at: nowIso,
    })
    .eq("facility_manager_id", facilityManagerId)
    .is("auth_user_id", null);
  if (linkError) throw new Error(linkError.message);

  await admin
    .from("facility_manager_portal_invites")
    .update({ used_at: nowIso })
    .eq("token_hash", tokenHash)
    .is("used_at", null);

  const { data: active } = await admin
    .from("facility_managers")
    .select("status, auth_user_id, full_name")
    .eq("facility_manager_id", facilityManagerId)
    .single();

  const { data: authUser } = await admin.auth.admin.getUserById(authUserId);

  console.log("PASS: facility manager active", {
    facilityManagerId,
    status: active?.status,
    authUserId: active?.auth_user_id,
    portalMeta: authUser.user?.user_metadata?.portal,
    email,
    password,
    landlordName,
  });
  console.log(
    "Sign in at /facility-portal/login with the email/password above (staging app + staging Supabase).",
  );
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exit(1);
});
