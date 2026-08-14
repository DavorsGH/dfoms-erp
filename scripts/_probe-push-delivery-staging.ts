/**
 * Probe push_subscriptions rows and attempt a verbose send for diagnostics.
 * Usage: npx tsx scripts/_probe-push-delivery-staging.ts --env-file .env.staging.local
 */
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })
  ._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: unknown,
  parent: unknown,
  isMain: unknown,
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

function maskEndpoint(endpoint: string): string {
  if (endpoint.length <= 48) return endpoint;
  return `${endpoint.slice(0, 40)}…${endpoint.slice(-8)}`;
}

async function main() {
  loadEnvFromArgv(process.argv);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(supabaseUrl.includes(STAGING_REF), "Refusing non-staging Supabase URL");
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  console.log("VAPID configured:", {
    public: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()),
    private: Boolean(process.env.VAPID_PRIVATE_KEY?.trim()),
    subject: process.env.VAPID_SUBJECT?.trim() || "(missing)",
  });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error } = await admin
    .from("push_subscriptions")
    .select(
      "id, recipient_user_id, persona, tenant_id, endpoint, p256dh, auth_key, user_agent, is_standalone_pwa, created_at, last_used_at, revoked_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  console.log(`\n--- push_subscriptions (${rows?.length ?? 0} rows) ---`);
  for (const row of rows ?? []) {
    console.log({
      id: row.id,
      persona: row.persona,
      recipient_user_id: row.recipient_user_id,
      tenant_id: row.tenant_id,
      endpoint: maskEndpoint(row.endpoint ?? ""),
      p256dh_len: row.p256dh?.length ?? 0,
      auth_key_len: row.auth_key?.length ?? 0,
      p256dh_ok: Boolean(row.p256dh?.trim()),
      auth_key_ok: Boolean(row.auth_key?.trim()),
      revoked_at: row.revoked_at,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      is_standalone_pwa: row.is_standalone_pwa,
      user_agent: row.user_agent?.slice(0, 80) ?? null,
    });
  }

  const active = (rows ?? []).filter((row) => !row.revoked_at);
  if (active.length === 0) {
    console.log("\nNo active subscriptions to test send.");
    return;
  }

  const target = active[0];
  console.log(`\n--- Verbose send test for subscription ${target.id} ---`);

  const { webpush, isWebPushConfigured } = await import("../utils/web-push-config");
  if (!isWebPushConfigured()) {
    console.log("FAIL: isWebPushConfigured() returned false in this process");
    return;
  }

  const payload = JSON.stringify({
    title: "[PROBE] Push delivery diagnostic",
    body: "If you see this OS banner, web-push → browser delivery works.",
    url: "http://localhost:3000/dashboard/my-account",
    tag: `probe-${Date.now()}`,
    notificationId: null,
  });

  try {
    const result = await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: {
          p256dh: target.p256dh,
          auth: target.auth_key,
        },
      },
      payload,
    );
    console.log("webpush.sendNotification SUCCESS:", {
      statusCode: result?.statusCode ?? "(no statusCode on result)",
      body: result?.body ?? "(empty)",
      headers: result?.headers ?? null,
    });
  } catch (sendError) {
    const err = sendError as {
      statusCode?: number;
      body?: string;
      message?: string;
      headers?: Record<string, string>;
    };
    console.log("webpush.sendNotification FAILED:", {
      statusCode: err.statusCode ?? null,
      message: err.message ?? String(sendError),
      body: err.body ?? null,
      headers: err.headers ?? null,
    });
  }

  const { sendWebPushForRecipient } = await import("../utils/web-push-send");
  console.log("\n--- sendWebPushForRecipient() wrapper test ---");
  await sendWebPushForRecipient({
    persona: target.persona as "staff" | "lessee" | "landlord",
    recipientUserId: target.recipient_user_id,
    tenantId: target.tenant_id,
    title: "[PROBE] Wrapper path test",
    body: "Second probe via sendWebPushForRecipient().",
    actionUrl: "/dashboard/my-account",
    notificationId: `probe-wrapper-${Date.now()}`,
  });
  console.log("sendWebPushForRecipient() completed (check logs above for errors)");

  const { data: after } = await admin
    .from("push_subscriptions")
    .select("last_used_at, revoked_at")
    .eq("id", target.id)
    .maybeSingle();
  console.log("\nSubscription after send:", after);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
