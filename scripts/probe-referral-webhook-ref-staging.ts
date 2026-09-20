/**
 * Probe referral state for a Paystack charge.success reference on staging.
 * Usage: npx tsx scripts/probe-referral-webhook-ref-staging.ts [reference]
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const REFERENCE = process.argv[2]?.trim() || "cbx6bw1nw9";

async function main() {
  const { client, envFile } = await connectPg({
    envFiles: [".env.staging.local", ".env.local"],
    requiredProjectRef: STAGING_REF,
  });
  console.log(`Connected via ${envFile}, reference=${REFERENCE}`);

  try {
    const webhook = await client.query(
      `SELECT event_type, event_key, processing_status, payload
       FROM public.paystack_webhook_events
       WHERE event_key = $1
          OR payload::text ILIKE $2
       LIMIT 5`,
      [`charge.success:${REFERENCE}`, `%${REFERENCE}%`],
    );
    console.log("\n=== paystack_webhook_events ===");
    if (!webhook.rows[0]) {
      console.log("(no row found)");
      return;
    }

    const payload = webhook.rows[0].payload as {
      data?: {
        reference?: string;
        amount?: number;
        metadata?: { tenant_id?: string };
        customer?: { email?: string };
      };
    };
    console.log({
      event_key: webhook.rows[0].event_key,
      processing_status: webhook.rows[0].processing_status,
      reference: payload?.data?.reference,
      amount_pesewas: payload?.data?.amount,
      customer_email: payload?.data?.customer?.email,
      metadata_tenant_id: payload?.data?.metadata?.tenant_id,
    });

    const linkedTenantId = payload?.data?.metadata?.tenant_id;
    if (!linkedTenantId) {
      console.log("\nCould not resolve linked_tenant_id from webhook metadata.");
      return;
    }

    console.log(`\nlinked_tenant_id=${linkedTenantId}`);

    const tenant = await client.query(
      `SELECT id, name, slug FROM public.tenants WHERE id = $1`,
      [linkedTenantId],
    );
    console.log("\n=== tenant ===");
    console.log(tenant.rows[0] ?? "(none)");

    const referral = await client.query(
      `SELECT referred_tenant_id, referrer_tenant_id, status, reward_amount_ghs,
              qualified_at, rewarded_at, created_at
       FROM public.referrals
       WHERE referred_tenant_id = $1`,
      [linkedTenantId],
    );
    console.log("\n=== referrals ===");
    console.log(referral.rows[0] ?? "(none)");

    const sub = await client.query(
      `SELECT id, subscription_status, activated_at, created_at, trial_end_date
       FROM public.crm_subscriptions
       WHERE linked_tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [linkedTenantId],
    );
    console.log("\n=== crm_subscriptions ===");
    console.log(sub.rows[0] ?? "(none)");

    if (referral.rows[0]?.referrer_tenant_id) {
      const credit = await client.query(
        `SELECT credit_balance FROM public.billing_settings
         WHERE tenant_id = $1`,
        [referral.rows[0].referrer_tenant_id],
      );
      const referrerTenant = await client.query(
        `SELECT id, name, slug FROM public.tenants WHERE id = $1`,
        [referral.rows[0].referrer_tenant_id],
      );
      console.log("\n=== referrer ===");
      console.log(referrerTenant.rows[0] ?? "(none)");
      console.log("\n=== referrer billing_settings.credit_balance ===");
      console.log(credit.rows[0] ?? "(none)");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
