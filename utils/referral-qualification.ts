import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyAccountCredit } from "@/utils/account-credit";
import { roundGhs } from "@/utils/product-sale-paystack";

type PendingReferralRow = {
  referrer_tenant_id: string;
  referred_tenant_id: string;
  reward_amount_ghs: number;
};

export async function maybeQualifyReferralOnFirstSubscriptionPayment(
  admin: SupabaseClient,
  input: {
    linkedTenantId: string;
    reference: string;
    wasFirstPaidActivation: boolean;
  },
): Promise<string | null> {
  const { linkedTenantId, reference } = input;

  if (!input.wasFirstPaidActivation) {
    console.log(
      `[referral-qualify] skip linked_tenant_id=${linkedTenantId} ref=${reference}: not first paid activation`,
    );
    return null;
  }

  const { data: referral, error: referralError } = await admin
    .from("referrals")
    .select("referrer_tenant_id, referred_tenant_id, reward_amount_ghs")
    .eq("referred_tenant_id", linkedTenantId)
    .eq("status", "pending")
    .maybeSingle();

  if (referralError) {
    throw new Error(referralError.message);
  }

  if (!referral) {
    console.log(
      `[referral-qualify] skip linked_tenant_id=${linkedTenantId} ref=${reference}: no pending referral row`,
    );
    return null;
  }

  const row = referral as PendingReferralRow;
  const rewardAmount = roundGhs(Number(row.reward_amount_ghs));
  const nowIso = new Date().toISOString();

  if (rewardAmount > 0) {
    await applyAccountCredit(admin, {
      tenantId: row.referrer_tenant_id,
      amountGhs: rewardAmount,
      reason: "referral_reward",
      reference: row.referred_tenant_id,
    });
  }

  const { error: updateError } = await admin
    .from("referrals")
    .update({
      status: "rewarded",
      qualified_at: nowIso,
      rewarded_at: nowIso,
    })
    .eq("referred_tenant_id", row.referred_tenant_id)
    .eq("status", "pending");

  if (updateError) {
    throw new Error(updateError.message);
  }

  console.log(
    `[referral-qualify] rewarded referrer_tenant_id=${row.referrer_tenant_id} referred_tenant_id=${row.referred_tenant_id} amount_ghs=${rewardAmount.toFixed(2)} ref=${reference}`,
  );

  return row.referred_tenant_id;
}
