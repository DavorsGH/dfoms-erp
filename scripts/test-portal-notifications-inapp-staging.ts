/**
 * Best-effort staging insert test for Phase 1 portal in-app notifications.
 * Uses service_role — does NOT require SQL apply via this script (table must exist).
 *
 * Usage: npx tsx scripts/test-portal-notifications-inapp-staging.ts
 *
 * Inserts one landlord_notifications row (if a landlord with auth_user_id exists)
 * and one lessee_notifications non-announcement row (if a lessee with auth_user_id exists),
 * then deletes them.
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
  try {
    loadEnvForce(resolve(process.cwd(), ".env.local"));
  } catch {
    // optional
  }
  try {
    loadEnvForce(resolve(process.cwd(), ".env"));
  } catch {
    // optional
  }

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: string[] = [];

  // --- Landlord insert ---
  const { data: landlord, error: landlordLookupError } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (landlordLookupError) {
    results.push(`FAIL landlord lookup: ${landlordLookupError.message}`);
  } else if (!landlord?.auth_user_id || !landlord.tenant_id) {
    results.push("SKIP landlord in-app: no landlord with auth_user_id on staging");
  } else {
    const { data: inserted, error: insertError } = await admin
      .from("landlord_notifications")
      .insert({
        tenant_id: landlord.tenant_id,
        recipient_user_id: landlord.auth_user_id,
        announcement_id: null,
        title: "[TEST] Phase 1 landlord in-app",
        body: "Staging probe — safe to ignore. Will be deleted.",
        action_url: "/landlord-portal/maintenance",
      })
      .select("id, action_url")
      .single();

    if (insertError) {
      results.push(
        `FAIL landlord insert (apply script 149?): ${insertError.message}`,
      );
    } else {
      results.push(
        `PASS landlord insert id=${inserted.id} action_url=${inserted.action_url}`,
      );
      await admin.from("landlord_notifications").delete().eq("id", inserted.id);
      results.push("PASS landlord row cleaned up");
    }
  }

  // --- Lessee non-announcement insert (action_url) ---
  const { data: lessee, error: lesseeLookupError } = await admin
    .from("lessees")
    .select("tenant_id, lessee_id, auth_user_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (lesseeLookupError) {
    results.push(`FAIL lessee lookup: ${lesseeLookupError.message}`);
  } else if (!lessee?.auth_user_id || !lessee.tenant_id || !lessee.lessee_id) {
    results.push("SKIP lessee in-app: no lessee with auth_user_id on staging");
  } else {
    const { data: inserted, error: insertError } = await admin
      .from("lessee_notifications")
      .insert({
        tenant_id: lessee.tenant_id,
        recipient_user_id: lessee.auth_user_id,
        lessee_id: lessee.lessee_id,
        announcement_id: null,
        title: "[TEST] Phase 1 lessee in-app",
        body: "Staging probe — complaint status style. Will be deleted.",
        action_url: "/portal/complaints",
      })
      .select("id, action_url")
      .single();

    if (insertError) {
      results.push(
        `FAIL lessee insert (apply script 150?): ${insertError.message}`,
      );
    } else {
      results.push(
        `PASS lessee insert id=${inserted.id} action_url=${inserted.action_url}`,
      );
      await admin.from("lessee_notifications").delete().eq("id", inserted.id);
      results.push("PASS lessee row cleaned up");
    }
  }

  for (const line of results) {
    console.log(line);
  }

  if (results.some((line) => line.startsWith("FAIL"))) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
