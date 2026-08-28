/**
 * Send a real FM invite email on staging for David Avors landlord.
 * Does NOT accept the invite. Uses the same hashed-token + Resend pattern as
 * POST /api/landlord-portal/facility-managers (inlined to avoid server-only).
 *
 * Usage: npx tsx scripts/_send-live-fm-invite-david-staging.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env.staging.local") });

const LANDLORD_EMAIL = "david.avors@unifaitechnologies.com";
const FM_EMAIL = "david.avors+fm@gmail.com";
const FM_NAME = "David Avors FM";
const EXPIRY_DAYS = 7;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function sendResend(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Davors Facilities ERP <noreply@davorsfacilities.com>",
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    return {
      ok: false,
      error: bodyText || `Resend failed (${response.status})`,
    };
  }

  let id = "";
  try {
    const parsed = JSON.parse(bodyText) as { id?: string };
    id = typeof parsed.id === "string" ? parsed.id.trim() : "";
  } catch {
    id = "";
  }
  if (!id) return { ok: false, error: "Resend returned no message id" };
  return { ok: true, id };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase staging credentials");
  }

  const host = new URL(url).hostname;
  if (!host.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error(`Refusing: expected staging host, got ${host}`);
  }

  // Local accept: FM routes are not on Vercel staging yet. Email link → localhost.
  const siteBase = "http://localhost:3000";

  console.log("supabase_host", host);
  console.log("invite_base_url", siteBase);
  console.log("resend_configured", Boolean(process.env.RESEND_API_KEY?.trim()));

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, name, email, product_line")
    .ilike("email", LANDLORD_EMAIL)
    .maybeSingle();

  if (tenantError) throw new Error(tenantError.message);
  if (!tenant) {
    throw new Error(`No tenant found for email ${LANDLORD_EMAIL}`);
  }

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, approval_status, landlord_type, auth_user_id")
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (landlordError) throw new Error(landlordError.message);
  if (!landlord) {
    throw new Error(`No landlords row for tenant ${tenant.id} (${tenant.name})`);
  }

  const { data: properties, error: propError } = await admin
    .from("properties")
    .select("property_id, name, city")
    .eq("tenant_id", tenant.id)
    .order("name", { ascending: true });

  if (propError) throw new Error(propError.message);
  if (!properties?.length) {
    throw new Error(`No properties for landlord tenant ${tenant.id}`);
  }

  const TARGET_PROPERTY_ID = "2173eeb6-acdd-4c62-9c3a-ddc305a80522";
  const property =
    properties.find((p) => p.property_id === TARGET_PROPERTY_ID) ?? null;
  if (!property) {
    throw new Error(
      `Expected property ${TARGET_PROPERTY_ID} not found for tenant ${tenant.id}`,
    );
  }
  const landlordName =
    typeof tenant.name === "string" && tenant.name.trim()
      ? tenant.name.trim()
      : "David Avors";

  console.log(
    JSON.stringify(
      {
        landlord: {
          tenant_id: tenant.id,
          name: tenant.name,
          email: tenant.email,
          approval_status: landlord.approval_status,
          landlord_type: landlord.landlord_type,
        },
        properties: properties.map((p) => ({
          property_id: p.property_id,
          name: p.name,
          city: p.city,
        })),
        assigned_property: {
          property_id: property.property_id,
          name: property.name,
          city: property.city,
        },
      },
      null,
      2,
    ),
  );

  const nowIso = new Date().toISOString();

  // Revoke any prior invited/active FM for this gmail on this tenant.
  const { data: prior } = await admin
    .from("facility_managers")
    .select("facility_manager_id, status")
    .eq("tenant_id", tenant.id)
    .ilike("email", FM_EMAIL)
    .in("status", ["invited", "active"]);

  for (const row of prior ?? []) {
    await admin
      .from("facility_manager_portal_invites")
      .update({ used_at: nowIso })
      .eq("facility_manager_id", row.facility_manager_id)
      .is("used_at", null);

    await admin
      .from("facility_managers")
      .update({
        status: "revoked",
        auth_user_id: null,
        revoked_at: nowIso,
        updated_at: nowIso,
      })
      .eq("facility_manager_id", row.facility_manager_id);

    console.log("revoked_prior_fm", row.facility_manager_id, row.status);
  }

  // Cross-persona: block if email already linked elsewhere as active persona.
  const [{ data: staff }, { data: lessee }, { data: otherFm }] =
    await Promise.all([
      admin
        .from("user_accounts")
        .select("auth_uid")
        .ilike("email", FM_EMAIL)
        .eq("is_active", true)
        .maybeSingle(),
      admin
        .from("lessees")
        .select("lessee_id")
        .ilike("email", FM_EMAIL)
        .not("auth_user_id", "is", null)
        .neq("status", "former")
        .maybeSingle(),
      admin
        .from("facility_managers")
        .select("facility_manager_id")
        .ilike("email", FM_EMAIL)
        .in("status", ["invited", "active"])
        .maybeSingle(),
    ]);

  if (staff) throw new Error("Cross-persona: email is active staff");
  if (lessee) throw new Error("Cross-persona: email is active lessee");
  if (otherFm) {
    throw new Error(
      "Cross-persona: another invited/active FM still exists for this email",
    );
  }

  const { data: fm, error: fmError } = await admin
    .from("facility_managers")
    .insert({
      tenant_id: tenant.id,
      full_name: FM_NAME,
      email: FM_EMAIL,
      status: "invited",
      can_manage_maintenance: true,
      can_manage_complaints: true,
      can_manage_inspections: true,
      can_log_services: true,
      can_collect_rent: true,
      can_collect_charges: true,
      invited_by_auth_uid: landlord.auth_user_id,
      invited_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(
      "facility_manager_id, status, email, full_name, can_manage_maintenance, can_manage_complaints, can_manage_inspections, can_log_services, can_collect_rent, can_collect_charges, auth_user_id",
    )
    .single();

  if (fmError || !fm) {
    throw new Error(fmError?.message ?? "FM insert failed");
  }

  const { error: assignError } = await admin
    .from("facility_manager_property_assignments")
    .insert({
      tenant_id: tenant.id,
      facility_manager_id: fm.facility_manager_id,
      property_id: property.property_id,
      created_by_auth_uid: landlord.auth_user_id,
      created_at: nowIso,
    });

  if (assignError) {
    await admin
      .from("facility_managers")
      .delete()
      .eq("facility_manager_id", fm.facility_manager_id);
    throw new Error(assignError.message);
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + EXPIRY_DAYS);

  const { error: inviteInsertError } = await admin
    .from("facility_manager_portal_invites")
    .insert({
      tenant_id: tenant.id,
      facility_manager_id: fm.facility_manager_id,
      email: FM_EMAIL,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      used_at: null,
      created_at: nowIso,
    });

  if (inviteInsertError) {
    await admin
      .from("facility_managers")
      .delete()
      .eq("facility_manager_id", fm.facility_manager_id);
    throw new Error(inviteInsertError.message);
  }

  const inviteUrl = `${siteBase}/facility-portal/accept-invite?token=${encodeURIComponent(rawToken)}`;
  const emailResult = await sendResend({
    to: FM_EMAIL,
    subject: "You're invited as a Facility Manager — Davors Facilities",
    html: `
      <h2>Welcome to the Facility Manager Portal</h2>
      <p>Hi ${FM_NAME},</p>
      <p>${landlordName} has invited you to manage properties on Davors Facilities.</p>
      <p><a href="${inviteUrl}">Accept invite and set your password</a></p>
      <p>This link expires in ${EXPIRY_DAYS} days. If you did not expect this email, you can ignore it.</p>
      <p style="color:#64748b;font-size:12px">Open this link on the machine where <code>npm run dev</code> is running (staging code is local; not yet on Vercel).</p>
    `,
    text: `Hi ${FM_NAME},\n\n${landlordName} has invited you to the Davors Facility Manager Portal.\n\nAccept your invite and set a password:\n${inviteUrl}\n\nThis link expires in ${EXPIRY_DAYS} days.\n\nOpen on the machine running npm run dev (local staging).\n`,
  });

  if (!emailResult.ok) {
    await admin
      .from("facility_manager_portal_invites")
      .delete()
      .eq("token_hash", tokenHash);
    await admin
      .from("facility_managers")
      .delete()
      .eq("facility_manager_id", fm.facility_manager_id);
    throw new Error(`Unable to send invite email: ${emailResult.error}`);
  }

  const { data: inviteRow } = await admin
    .from("facility_manager_portal_invites")
    .select("invite_id, email, expires_at, used_at, created_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  const { data: fmAfter } = await admin
    .from("facility_managers")
    .select("facility_manager_id, status, auth_user_id, email, full_name")
    .eq("facility_manager_id", fm.facility_manager_id)
    .single();

  console.log(
    JSON.stringify(
      {
        result: "EMAIL_SENT",
        resend_message_id: emailResult.id,
        invite_url_for_local_dev: inviteUrl,
        facility_manager: fmAfter,
        capabilities: {
          can_manage_maintenance: fm.can_manage_maintenance,
          can_manage_complaints: fm.can_manage_complaints,
          can_manage_inspections: fm.can_manage_inspections,
          can_log_services: fm.can_log_services,
          can_collect_rent: fm.can_collect_rent,
          can_collect_charges: fm.can_collect_charges,
        },
        assigned_property: {
          property_id: property.property_id,
          name: property.name,
          city: property.city,
        },
        pending_invite: inviteRow,
        note:
          "Invite NOT accepted. Open the Gmail message (or the local invite URL above) while npm run dev is running against staging.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
