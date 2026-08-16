import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildUniqueSlugCandidates,
  slugifyCompanyName,
} from "../../utils/tenant-signup";

const ERP_SUITE_TRIAL_DAYS = 90;

export async function resolveAvailableSlug(admin: SupabaseClient, name: string) {
  const baseSlug = slugifyCompanyName(name);
  const candidates = buildUniqueSlugCandidates(baseSlug);
  const { data: existingRows, error } = await admin
    .from("tenants")
    .select("slug")
    .in("slug", candidates);
  if (error) {
    throw new Error(error.message);
  }
  const taken = new Set((existingRows ?? []).map((row) => row.slug));
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}

export async function createTestPendingLandlord(
  admin: SupabaseClient,
  input: { name: string; email: string; phone: string; address: string },
) {
  const slug = await resolveAvailableSlug(admin, input.name);
  if (!slug) {
    throw new Error("Unable to resolve slug");
  }

  const now = new Date().toISOString();
  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .insert({
      name: input.name,
      slug,
      status: "active",
      product_line: "real_estate_only",
      email: input.email,
      phone: input.phone,
      address: input.address,
      updated_at: now,
    })
    .select("id")
    .single();
  if (tenantError || !tenantRow) {
    throw new Error(tenantError?.message ?? "tenant insert failed");
  }

  const { error: landlordError } = await admin.from("landlords").insert({
    tenant_id: tenantRow.id,
    landlord_type: "platform_only",
    approval_status: "pending",
    sms_credit_balance: 0,
    created_at: now,
    updated_at: now,
  });
  if (landlordError) {
    throw new Error(landlordError.message);
  }

  return tenantRow.id as string;
}

/** Mirrors approveLandlordTenant + trial seed for script tests (no server-only import). */
export async function approveLandlordForTest(
  admin: SupabaseClient,
  tenantId: string,
) {
  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("approval_status, landlord_type")
    .eq("tenant_id", tenantId)
    .single();
  if (landlordError || !landlord) {
    throw new Error(landlordError?.message ?? "landlord load failed");
  }

  if (landlord.approval_status === "approved") {
    return { transitioned: false };
  }

  const allowed = new Set(["pending", "suspended", "rejected"]);
  if (!allowed.has(landlord.approval_status ?? "")) {
    throw new Error(
      `Cannot approve landlord with status ${landlord.approval_status ?? "null"}`,
    );
  }

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      approval_status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
  if (updateError) {
    throw new Error(updateError.message);
  }

  const { data: existingSub } = await admin
    .from("landlord_subscriptions")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!existingSub && landlord.landlord_type === "platform_only") {
    const trialEnd = new Date();
    trialEnd.setUTCDate(trialEnd.getUTCDate() + ERP_SUITE_TRIAL_DAYS);
    const trialEndsAt = trialEnd.toISOString().slice(0, 10);
    const periodStart = new Date().toISOString().slice(0, 10);

    const { error: subError } = await admin.from("landlord_subscriptions").insert({
      tenant_id: tenantId,
      tier: "platform",
      status: "trialing",
      trial_ends_at: trialEndsAt,
      active_unit_count: 0,
      included_units: 0,
      base_price_ghs: 0,
      extra_unit_price_ghs: 0,
      current_period_price_ghs: 0,
      current_period_start: periodStart,
      current_period_end: trialEndsAt,
      billing_cycle: "monthly",
      pending_billing_cycle: null,
    });
    if (subError) {
      throw new Error(subError.message);
    }
  }

  return { transitioned: true };
}

const PORTAL_BAN_DURATION = "876000h";

export function isAuthUserBanned(
  bannedUntil: string | null | undefined,
  now = new Date(),
): boolean {
  if (!bannedUntil) return false;
  const until = new Date(bannedUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}

export async function suspendLandlordAuthForTest(
  admin: SupabaseClient,
  authUserId: string,
) {
  const { error: banError } = await admin.auth.admin.updateUserById(authUserId, {
    ban_duration: PORTAL_BAN_DURATION,
  });
  if (banError) {
    throw new Error(banError.message);
  }
  const signOut = admin.auth.admin.signOut as
    | ((userId: string, scope?: "global" | "local" | "others") => Promise<{
        error: Error | null;
      }>)
    | undefined;
  if (typeof signOut === "function") {
    await signOut.call(admin.auth.admin, authUserId, "global");
  }
}

export async function reactivateLandlordAuthForTest(
  admin: SupabaseClient,
  authUserId: string,
) {
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    ban_duration: "none",
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function createLandlordPortalInviteRowForTest(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
) {
  const { createHash, randomBytes } = await import("node:crypto");
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { error } = await admin.from("landlord_portal_invites").insert({
    tenant_id: tenantId,
    email: email.trim().toLowerCase(),
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    used_at: null,
    created_at: now.toISOString(),
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Mirrors onboardStaffCreatedLandlord for script tests (invite row only, no email). */
export async function onboardStaffCreatedLandlordForTest(
  admin: SupabaseClient,
  input: { tenantId: string; email: string },
) {
  await approveLandlordForTest(admin, input.tenantId);
  await createLandlordPortalInviteRowForTest(admin, input.tenantId, input.email);
}
