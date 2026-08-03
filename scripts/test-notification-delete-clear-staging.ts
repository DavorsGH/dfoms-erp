/**
 * Staging smoke: insert + delete via service_role on all three notification
 * tables (proves DELETE path / grants; UI APIs use the same tables under RLS).
 *
 * Usage: npx tsx scripts/test-notification-delete-clear-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function main() {
  for (const envFile of [".env.staging.local", ".env.local", ".env"]) {
    try {
      loadEnvForce(resolve(process.cwd(), envFile));
    } catch {
      // optional
    }
  }

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error(`Refusing non-staging URL: ${url}`);
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- employee ---
  const { data: empRecipient } = await admin
    .from("employee_notifications")
    .select("tenant_id, recipient_user_id")
    .limit(1)
    .maybeSingle();
  if (empRecipient) {
    const { data: inserted, error } = await admin
      .from("employee_notifications")
      .insert({
        tenant_id: empRecipient.tenant_id,
        recipient_user_id: empRecipient.recipient_user_id,
        title: "Delete smoke test",
        body: "temporary",
        action_url: "/dashboard/real-estate/landlords?highlight=00000000-0000-0000-0000-000000000000",
        read_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`employee insert: ${error?.message}`);
    const { error: delErr } = await admin
      .from("employee_notifications")
      .delete()
      .eq("id", inserted.id);
    if (delErr) throw new Error(`employee delete: ${delErr.message}`);
    console.log("PASS employee_notifications insert+delete");
  } else {
    console.log("SKIP employee_notifications: no seed recipient");
  }

  // --- landlord ---
  const { data: landlord } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (landlord?.auth_user_id) {
    const { data: inserted, error } = await admin
      .from("landlord_notifications")
      .insert({
        tenant_id: landlord.tenant_id,
        recipient_user_id: landlord.auth_user_id,
        title: "Delete smoke test",
        body: "temporary",
        action_url: "/landlord-portal/maintenance",
        read_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`landlord insert: ${error?.message}`);
    const { error: delErr } = await admin
      .from("landlord_notifications")
      .delete()
      .eq("id", inserted.id);
    if (delErr) throw new Error(`landlord delete: ${delErr.message}`);
    console.log("PASS landlord_notifications insert+delete");
  } else {
    console.log("SKIP landlord_notifications: no landlord with auth_user_id");
  }

  // --- lessee ---
  const { data: lessee } = await admin
    .from("lessees")
    .select("id, tenant_id, auth_user_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();
  const { data: lesseeSeed } = !lessee?.auth_user_id
    ? await admin
        .from("lessee_notifications")
        .select("tenant_id, lessee_id, recipient_user_id")
        .limit(1)
        .maybeSingle()
    : { data: null };
  const lesseeTarget = lessee?.auth_user_id
    ? {
        tenant_id: lessee.tenant_id,
        lessee_id: lessee.id,
        recipient_user_id: lessee.auth_user_id,
      }
    : lesseeSeed;
  if (lesseeTarget?.recipient_user_id && lesseeTarget.lessee_id) {
    const { data: inserted, error } = await admin
      .from("lessee_notifications")
      .insert({
        tenant_id: lesseeTarget.tenant_id,
        lessee_id: lesseeTarget.lessee_id,
        recipient_user_id: lesseeTarget.recipient_user_id,
        title: "Delete smoke test",
        body: "temporary",
        action_url: "/portal/complaints",
        read_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`lessee insert: ${error?.message}`);
    const { error: delErr } = await admin
      .from("lessee_notifications")
      .delete()
      .eq("id", inserted.id);
    if (delErr) throw new Error(`lessee delete: ${delErr.message}`);
    console.log("PASS lessee_notifications insert+delete");
  } else {
    console.log("SKIP lessee_notifications: no recipient seed");
  }

  console.log("PASS notification delete smoke");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
