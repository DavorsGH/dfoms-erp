import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildUniqueSlugCandidates,
  isDuplicateSlugError,
  normalizeSignupEmail,
  slugifyCompanyName,
} from "@/utils/tenant-signup";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CreatePendingLandlordInput = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

export type CreatePendingLandlordResult =
  | { ok: true; tenantId: string; name: string; email: string }
  | { ok: false; error: string; status: number };

export type ValidatedPendingLandlordInput = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

/**
 * Shared validation for staff Add Landlord and public landlord self-signup.
 */
export function validatePendingLandlordInput(input: {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}):
  | { ok: true; data: ValidatedPendingLandlordInput }
  | { ok: false; error: string } {
  const name = input.name?.trim() ?? "";
  const email = normalizeSignupEmail(input.email ?? "");
  const phone = input.phone?.trim() ?? "";
  const address = input.address?.trim() ?? "";

  if (!name) {
    return { ok: false, error: "Landlord name is required." };
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "A valid email is required." };
  }
  if (!phone) {
    return { ok: false, error: "Phone is required." };
  }
  if (!address) {
    return { ok: false, error: "Address is required." };
  }

  return { ok: true, data: { name, email, phone, address } };
}

async function resolveAvailableSlug(
  admin: SupabaseClient,
  name: string,
): Promise<string | null> {
  const baseSlug = slugifyCompanyName(name);
  const candidates = buildUniqueSlugCandidates(baseSlug);

  const { data: existingRows, error } = await admin
    .from("tenants")
    .select("slug")
    .in("slug", candidates);

  if (error) {
    return null;
  }

  const taken = new Set((existingRows ?? []).map((row) => row.slug));
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}

/**
 * Creates tenants (real_estate_only) + landlords (pending, platform_only).
 * Does not create Auth users or send notifications — callers handle those.
 */
export async function createPendingLandlordTenant(
  admin: SupabaseClient,
  input: CreatePendingLandlordInput,
): Promise<CreatePendingLandlordResult> {
  const validation = validatePendingLandlordInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }

  const { name, email, phone, address } = validation.data;

  // Soft uniqueness: tenants.email has no DB unique constraint, but portal
  // invites and staff notifications rely on it as the landlord contact.
  const { data: emailMatches, error: emailLookupError } = await admin
    .from("tenants")
    .select("id")
    .eq("product_line", "real_estate_only")
    .ilike("email", email)
    .limit(1);

  if (emailLookupError) {
    return { ok: false, error: emailLookupError.message, status: 400 };
  }
  if (emailMatches && emailMatches.length > 0) {
    return {
      ok: false,
      error:
        "A landlord with this email already exists. Use a different email or open the existing landlord.",
      status: 409,
    };
  }

  const slug = await resolveAvailableSlug(admin, name);
  if (!slug) {
    return {
      ok: false,
      error: "Unable to verify landlord name availability. Please try again.",
      status: 503,
    };
  }

  const now = new Date().toISOString();

  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .insert({
      name,
      slug,
      status: "active",
      product_line: "real_estate_only",
      email,
      phone,
      address,
      updated_at: now,
    })
    .select("id")
    .single();

  if (tenantError || !tenantRow) {
    return {
      ok: false,
      error: isDuplicateSlugError(tenantError?.message ?? "")
        ? "A landlord with a similar name already exists. Try a different name."
        : (tenantError?.message ?? "Failed to create landlord tenant."),
      status: 400,
    };
  }

  const tenantId = tenantRow.id as string;

  // Matches update-route pending insert + DB defaults (platform_only, sms 0).
  const { error: landlordError } = await admin.from("landlords").insert({
    tenant_id: tenantId,
    landlord_type: "platform_only",
    approval_status: "pending",
    sms_credit_balance: 0,
    management_fee_percent: null,
    paystack_subaccount_code: null,
    paystack_subaccount_status: "not_setup",
    notification_phone: null,
    created_at: now,
    updated_at: now,
  });

  if (landlordError) {
    await admin.from("tenants").delete().eq("id", tenantId);
    return {
      ok: false,
      error: landlordError.message ?? "Failed to create landlord profile.",
      status: 400,
    };
  }

  return { ok: true, tenantId, name, email };
}

/** Best-effort cleanup when auth linking fails after tenant/landlord insert. */
export async function rollbackPendingLandlordTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<void> {
  await admin.from("landlords").delete().eq("tenant_id", tenantId);
  await admin.from("tenants").delete().eq("id", tenantId);
}
