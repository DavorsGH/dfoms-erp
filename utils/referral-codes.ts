import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getReferralRewardGhs } from "@/utils/platform-billing-config";

const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REFERRAL_CODE_LENGTH = 8;
const MAX_GENERATION_ATTEMPTS = 12;

export type ReferralCodeRow = {
  tenant_id: string;
  code: string;
  created_at: string;
};

export type ReferralRow = {
  referrer_tenant_id: string;
  referred_tenant_id: string;
  status: "pending" | "rewarded" | "expired";
  reward_amount_ghs: number;
  qualified_at: string | null;
  rewarded_at: string | null;
  created_at: string;
};

export const REFERRAL_CODE_SELECT = "tenant_id, code, created_at";

function randomReferralCode(): string {
  let code = "";
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    const charIndex = Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length);
    code += REFERRAL_CODE_ALPHABET[charIndex];
  }
  return code;
}

export async function createReferralCodeForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ReferralCodeRow> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const code = randomReferralCode();
    const { data, error } = await admin
      .from("referral_codes")
      .insert({ tenant_id: tenantId, code })
      .select(REFERRAL_CODE_SELECT)
      .single();

    if (!error && data) {
      return data as ReferralCodeRow;
    }

    if (error?.code === "23505") {
      const existing = await getReferralCodeForTenant(admin, tenantId);
      if (existing) {
        return existing;
      }
      continue;
    }

    throw new Error(error?.message ?? "Failed to create referral code.");
  }

  throw new Error("Unable to generate a unique referral code.");
}

/** Return existing code or create one (signup + Billing Settings backfill). */
export async function ensureReferralCodeForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ReferralCodeRow> {
  const existing = await getReferralCodeForTenant(admin, tenantId);
  if (existing) {
    return existing;
  }

  return createReferralCodeForTenant(admin, tenantId);
}

export async function getReferralCodeForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ReferralCodeRow | null> {
  const { data, error } = await admin
    .from("referral_codes")
    .select(REFERRAL_CODE_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as ReferralCodeRow | null) ?? null;
}

export async function resolveReferrerTenantIdByCode(
  admin: SupabaseClient,
  referralCodeInput: string | null | undefined,
): Promise<{ referrerTenantId: string; code: string } | null> {
  const normalized = referralCodeInput?.trim().toUpperCase() ?? "";
  if (!normalized) {
    return null;
  }

  const { data, error } = await admin
    .from("referral_codes")
    .select("tenant_id, code")
    .eq("code", normalized)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.tenant_id) {
    return null;
  }

  return {
    referrerTenantId: data.tenant_id as string,
    code: data.code as string,
  };
}

/** Best-effort signup referral capture; never throws (bonus feature, not blocking). */
export async function captureReferralAtSignup(
  admin: SupabaseClient,
  input: {
    referredTenantId: string;
    referralCodeInput?: string | null;
  },
): Promise<void> {
  const referredTenantId = input.referredTenantId;
  const rawCode = input.referralCodeInput?.trim() ?? "";

  try {
    if (!rawCode) {
      console.log(
        `[referral-capture] skip referred_tenant_id=${referredTenantId}: no referral code provided`,
      );
      return;
    }

    const resolved = await resolveReferrerTenantIdByCode(
      admin,
      input.referralCodeInput,
    );
    if (!resolved) {
      console.log(
        `[referral-capture] skip referred_tenant_id=${referredTenantId}: invalid code "${rawCode.toUpperCase()}"`,
      );
      return;
    }

    if (resolved.referrerTenantId === referredTenantId) {
      console.log(
        `[referral-capture] skip referred_tenant_id=${referredTenantId}: self-referral code=${resolved.code}`,
      );
      return;
    }

    let rewardAmountGhs: number;
    try {
      rewardAmountGhs = await getReferralRewardGhs(admin);
    } catch (rewardError) {
      console.error(
        `[referral-capture] referral_reward_ghs config unavailable for referred_tenant_id=${referredTenantId}:`,
        rewardError,
      );
      return;
    }

    const { error } = await admin.from("referrals").insert({
      referrer_tenant_id: resolved.referrerTenantId,
      referred_tenant_id: referredTenantId,
      status: "pending",
      reward_amount_ghs: rewardAmountGhs,
    });

    if (error?.code === "23505") {
      console.log(
        `[referral-capture] duplicate referral row for referred_tenant_id=${referredTenantId} code=${resolved.code}`,
      );
      return;
    }

    if (error) {
      console.error(
        `[referral-capture] referrals insert failed for referred_tenant_id=${referredTenantId}:`,
        error.message,
      );
      return;
    }

    console.log(
      `[referral-capture] created pending referral referred_tenant_id=${referredTenantId} referrer_tenant_id=${resolved.referrerTenantId} code=${resolved.code} reward_ghs=${rewardAmountGhs.toFixed(2)}`,
    );
  } catch (error) {
    console.error(
      `[referral-capture] signup referral capture failed for referred_tenant_id=${referredTenantId}:`,
      error,
    );
  }
}
