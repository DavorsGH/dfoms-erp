/**
 * Cross-check: does sendWebPushForRecipient find subscriptions when called
 * with the same keys as a recent employee_notification insert?
 *
 * Usage: npx tsx scripts/_probe-push-notification-match-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  loadEnvFromArgv(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), "staging only");
  assert(key, "service key required");

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("recipient_user_id, tenant_id, persona, last_used_at")
    .is("revoked_at", null);

  const { data: notes } = await admin
    .from("employee_notifications")
    .select("id, recipient_user_id, tenant_id, title, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  console.log("\n--- Active subscriptions ---");
  console.log(subs);

  console.log("\n--- Recent employee_notifications ---");
  console.log(notes);

  for (const sub of subs ?? []) {
    const matching = (notes ?? []).filter(
      (n) =>
        n.recipient_user_id === sub.recipient_user_id &&
        n.tenant_id === sub.tenant_id,
    );
    console.log(`\nSubscription ${sub.persona} user ${sub.recipient_user_id}:`);
    console.log(`  matching recent notifications: ${matching.length}`);
    if (matching[0]) {
      console.log(`  latest: ${matching[0].title} @ ${matching[0].created_at}`);
    }

    const { count } = await admin
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("persona", sub.persona)
      .eq("recipient_user_id", sub.recipient_user_id)
      .eq("tenant_id", sub.tenant_id)
      .is("revoked_at", null);
    console.log(`  lookup count (sendWebPush filter): ${count}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
