/**
 * End-to-end staging push test: trigger real in-app notifications (with push fan-out)
 * for staff, lessee, and landlord personas.
 *
 * Usage:
 *   npx tsx scripts/test-web-push-full-staging.ts --env-file .env.staging.local
 *
 * Set VAPID_* env vars in the shell or env file before running.
 */
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import type { PushPersona } from "../utils/push-notification-types";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })
  ._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: unknown,
  parent: unknown,
  isMain: unknown,
) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad(request, parent, isMain);
};

async function subscriptionCount(
  admin: ReturnType<typeof createClient<any>>,
  persona: PushPersona,
): Promise<number> {
  const { count, error } = await admin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("persona", persona)
    .is("revoked_at", null);

  if (error) {
    throw new Error(`${persona} subscription count: ${error.message}`);
  }

  return count ?? 0;
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

  const { notifyTenantAdminsAndDirectors } = await import(
    "../utils/tenant-admin-director-notifications"
  );
  const { insertLesseePortalNotification } = await import(
    "../utils/lessee-portal-notifications"
  );
  const { insertLandlordPortalNotification } = await import(
    "../utils/landlord-portal-notifications"
  );

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("\n--- Active push subscriptions ---");
  for (const persona of ["staff", "lessee", "landlord"] as const) {
    console.log(`${persona}: ${await subscriptionCount(admin, persona)}`);
  }

  const { DAVORS_TENANT_ID } = await import("../utils/tenant-signup");

  const staffTenantId = DAVORS_TENANT_ID;
  if (staffTenantId) {
    await notifyTenantAdminsAndDirectors(
      staffTenantId,
      "[TEST] Staff push notification",
      "Staging Web Push test — safe to ignore.",
      "/dashboard/my-account",
    );
    console.log("\nPASS staff: notifyTenantAdminsAndDirectors invoked");
  } else {
    console.log("\nSKIP staff: Davors tenant not found on staging");
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("tenant_id, lessee_id, auth_user_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (lessee?.auth_user_id && lessee.tenant_id && lessee.lessee_id) {
    const inserted = await insertLesseePortalNotification({
      landlordTenantId: lessee.tenant_id,
      lesseeId: lessee.lessee_id,
      title: "[TEST] Lessee push notification",
      body: "Staging Web Push test — safe to ignore.",
      actionUrl: "/portal/account-security",
      context: "web-push-full-staging-test",
    });
    console.log(
      inserted
        ? "\nPASS lessee: insertLesseePortalNotification + push invoked"
        : "\nFAIL lessee: insert returned false",
    );
  } else {
    console.log("\nSKIP lessee: no lessee with auth_user_id on staging");
  }

  const { data: landlord } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (landlord?.auth_user_id && landlord.tenant_id) {
    const inserted = await insertLandlordPortalNotification({
      landlordTenantId: landlord.tenant_id,
      title: "[TEST] Landlord push notification",
      body: "Staging Web Push test — safe to ignore.",
      actionUrl: "/landlord-portal/administration/account-security",
      context: "web-push-full-staging-test",
    });
    console.log(
      inserted
        ? "\nPASS landlord: insertLandlordPortalNotification + push invoked"
        : "\nFAIL landlord: insert returned false",
    );
  } else {
    console.log("\nSKIP landlord: no landlord with auth_user_id on staging");
  }

  console.log(
    "\nNote: device delivery requires a subscribed browser session on staging/local.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
