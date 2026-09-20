/**
 * Verify apply_account_credit on staging, reload PostgREST schema, backfill Test F.
 * Usage: npx tsx scripts/verify-apply-account-credit-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TEST_F_REFERRED_TENANT_ID = "9e7393c7-ab3a-47af-87bd-51da92fd07d4";
const TEST_F_REFERRER_TENANT_ID = "a5cd3e11-6483-49b6-97c5-f8f3a3472362";

async function main() {
  const { client, envFile } = await connectPg({
    envFiles: [".env.staging.local", ".env.local"],
    requiredProjectRef: STAGING_REF,
  });
  console.log(`Connected via ${envFile}`);

  try {
    const { rows: fnRows } = await client.query(
      `SELECT proname, pg_get_function_arguments(oid) AS arguments
       FROM pg_proc
       WHERE proname = 'apply_account_credit'
         AND pronamespace = 'public'::regnamespace`,
    );
    console.log("\n=== apply_account_credit on staging ===");
    console.log(fnRows);

    const { rows: grants } = await client.query(
      `SELECT grantee, privilege_type
       FROM information_schema.routine_privileges
       WHERE routine_schema = 'public'
         AND routine_name = 'apply_account_credit'`,
    );
    console.log("\n=== routine_privileges ===");
    console.log(grants);

    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log("\nPostgREST schema reload notified.");

    const { rows: pending } = await client.query(
      `SELECT referred_tenant_id, referrer_tenant_id, reward_amount_ghs
       FROM public.referrals
       WHERE referred_tenant_id = $1
         AND status = 'pending'`,
      [TEST_F_REFERRED_TENANT_ID],
    );

    if (pending[0]) {
      const rewardAmount = Number(pending[0].reward_amount_ghs);
      await client.query(
        `SELECT public.apply_account_credit($1::uuid, $2::numeric, 'referral_reward', $3::text)`,
        [TEST_F_REFERRER_TENANT_ID, rewardAmount, TEST_F_REFERRED_TENANT_ID],
      );
      await client.query(
        `UPDATE public.referrals
         SET status = 'rewarded',
             qualified_at = now(),
             rewarded_at = now()
         WHERE referred_tenant_id = $1
           AND status = 'pending'`,
        [TEST_F_REFERRED_TENANT_ID],
      );
      console.log(
        `\nBackfilled Test F referral: referrer=${TEST_F_REFERRER_TENANT_ID} amount_ghs=${rewardAmount.toFixed(2)}`,
      );
    } else {
      console.log("\nNo pending Test F referral to backfill.");
    }

    const { rows: credit } = await client.query(
      `SELECT credit_balance FROM public.billing_settings WHERE tenant_id = $1`,
      [TEST_F_REFERRER_TENANT_ID],
    );
    console.log("\n=== referrer credit_balance after backfill ===");
    console.log(credit[0] ?? "(none)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
