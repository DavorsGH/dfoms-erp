/**
 * Probe referral capture + qualification for a referred tenant on staging.
 * Usage: npx tsx scripts/probe-referral-test-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const REFERRED_TENANT_ID = "8971843e-4c6f-4da9-be3a-a13688f88adc";

async function main() {
  const { client, envFile } = await connectPg({
    envFiles: [".env.staging.local", ".env.local"],
    requiredProjectRef: STAGING_REF,
  });
  console.log(`Connected via ${envFile}`);

  try {
    const referral = await client.query(
      `SELECT referred_tenant_id, referrer_tenant_id, status, reward_amount_ghs,
              qualified_at, rewarded_at, created_at
       FROM public.referrals
       WHERE referred_tenant_id = $1`,
      [REFERRED_TENANT_ID],
    );
    console.log("\n=== referrals row ===");
    console.log(referral.rows[0] ?? "(none)");

    const sub = await client.query(
      `SELECT id, linked_tenant_id, subscription_status, activated_at,
              created_at, trial_end_date, paystack_subscription_id
       FROM public.crm_subscriptions
       WHERE linked_tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [REFERRED_TENANT_ID],
    );
    console.log("\n=== crm_subscriptions ===");
    console.log(sub.rows[0] ?? "(none)");

    const tenant = await client.query(
      `SELECT id, name, slug FROM public.tenants WHERE id = $1`,
      [REFERRED_TENANT_ID],
    );
    console.log("\n=== tenant ===");
    console.log(tenant.rows[0] ?? "(none)");

    const userAccount = await client.query(
      `SELECT auth_uid, email, tenant_id, created_at
       FROM public.user_accounts
       WHERE tenant_id = $1
       ORDER BY created_at ASC
       LIMIT 3`,
      [REFERRED_TENANT_ID],
    );
    console.log("\n=== user_accounts (referred tenant) ===");
    console.log(userAccount.rows);

    const webhook = await client.query(
      `SELECT event_type, event_key, detail, created_at
       FROM public.paystack_webhook_events
       WHERE detail ILIKE $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [`%${REFERRED_TENANT_ID}%`],
    );
    console.log("\n=== paystack_webhook_events ===");
    for (const row of webhook.rows) {
      console.log(row);
    }

    if (referral.rows[0]?.referrer_tenant_id) {
      const referrerCode = await client.query(
        `SELECT tenant_id, code, created_at
         FROM public.referral_codes
         WHERE tenant_id = $1`,
        [referral.rows[0].referrer_tenant_id],
      );
      console.log("\n=== referrer referral_codes ===");
      console.log(referrerCode.rows[0] ?? "(none)");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
