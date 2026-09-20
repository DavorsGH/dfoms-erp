/**
 * Reward pending referrals whose referred tenant already has activated_at set
 * (missed by the pre-fix qualification bug). Staging only.
 *
 * Usage: npx tsx scripts/reward-stuck-pending-referrals-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    envFiles: [".env.staging.local", ".env.local"],
    requiredProjectRef: STAGING_REF,
  });
  console.log(`Connected via ${envFile}`);

  try {
    const { rows: pending } = await client.query(
      `SELECT referred_tenant_id, referrer_tenant_id, reward_amount_ghs
       FROM public.referrals
       WHERE status = 'pending'`,
    );

    console.log(`Found ${pending.length} pending referral(s).`);

    for (const row of pending) {
      const referredTenantId = row.referred_tenant_id as string;
      const referrerTenantId = row.referrer_tenant_id as string;
      const rewardAmount = Number(row.reward_amount_ghs);

      const { rows: subs } = await client.query(
        `SELECT id, activated_at
         FROM public.crm_subscriptions
         WHERE linked_tenant_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [referredTenantId],
      );

      if (!subs[0]?.activated_at) {
        console.log(
          `Skip referred_tenant_id=${referredTenantId}: subscription not activated yet.`,
        );
        continue;
      }

      if (Number.isFinite(rewardAmount) && rewardAmount > 0) {
        await client.query(
          `SELECT public.apply_account_credit($1::uuid, $2::numeric, 'referral_reward', $3::text)`,
          [referrerTenantId, rewardAmount, referredTenantId],
        );
      }

      const { rowCount } = await client.query(
        `UPDATE public.referrals
         SET status = 'rewarded',
             qualified_at = now(),
             rewarded_at = now()
         WHERE referred_tenant_id = $1
           AND status = 'pending'`,
        [referredTenantId],
      );

      if ((rowCount ?? 0) > 0) {
        console.log(
          `[referral-qualify] backfill rewarded referrer_tenant_id=${referrerTenantId} referred_tenant_id=${referredTenantId} amount_ghs=${rewardAmount.toFixed(2)}`,
        );
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
