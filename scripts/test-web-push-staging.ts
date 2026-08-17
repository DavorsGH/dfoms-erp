/**
 * Staging smoke test for Web Push wiring.
 *
 * Prerequisites:
 * - scripts/218_push_subscriptions.sql applied on staging
 * - VAPID env vars set locally in .env.staging.local
 * - At least one active push_subscriptions row per persona under test
 *
 * Usage:
 *   npx tsx scripts/test-web-push-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import { sendWebPushForRecipient } from "../utils/web-push-send";
import type { PushPersona } from "../utils/push-notification-types";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function testPersona(
  admin: ReturnType<typeof createClient<any>>,
  persona: PushPersona,
): Promise<void> {
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("recipient_user_id, tenant_id")
    .eq("persona", persona)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log(`FAIL ${persona}: subscription lookup — ${error.message}`);
    return;
  }

  const row = data as { recipient_user_id?: string; tenant_id?: string } | null;
  if (!row?.recipient_user_id || !row?.tenant_id) {
    console.log(`SKIP ${persona}: no active push subscription on staging`);
    return;
  }

  await sendWebPushForRecipient({
    persona,
    recipientUserId: row.recipient_user_id,
    tenantId: row.tenant_id,
    title: `DFOMS ${persona} push test`,
    body: "If you see this notification, staging Web Push delivery works.",
    actionUrl:
      persona === "staff"
        ? "/dashboard/my-account"
        : persona === "lessee"
          ? "/portal/account"
          : "/landlord-portal/account",
    notificationId: `staging-test-${persona}`,
  });

  console.log(`PASS ${persona}: sendWebPushForRecipient invoked`);
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv);
  console.log(`Using env file: ${envFile}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(supabaseUrl.includes(STAGING_REF), "Refusing non-staging Supabase URL");
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");
  assert(process.env.VAPID_PRIVATE_KEY?.trim(), "Missing VAPID_PRIVATE_KEY");
  assert(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim(),
    "Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  );
  assert(process.env.VAPID_SUBJECT?.trim(), "Missing VAPID_SUBJECT");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: tableError } = await admin
    .from("push_subscriptions")
    .select("id")
    .limit(1);

  if (tableError) {
    throw new Error(
      `push_subscriptions missing on staging — apply 218 first: ${tableError.message}`,
    );
  }

  for (const persona of ["staff", "lessee", "landlord"] as const) {
    await testPersona(admin, persona);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
