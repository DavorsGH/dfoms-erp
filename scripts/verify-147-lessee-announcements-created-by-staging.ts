/**
 * Verify landlord auth_user_id can be stored on lessee_announcements.created_by.
 * Uses service role (no direct Postgres). Safe: inserts then deletes a draft row.
 *
 * Usage: npx tsx scripts/verify-147-lessee-announcements-created-by-staging.ts
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
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii") || !key) {
    throw new Error("Staging Supabase URL / service role missing");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, name")
    .eq("name", "Test Landlord Co")
    .maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  if (!tenant?.id) throw new Error('Tenant "Test Landlord Co" not found');

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id, landlord_type")
    .eq("tenant_id", tenant.id)
    .not("auth_user_id", "is", null)
    .maybeSingle();

  if (landlordError) throw new Error(landlordError.message);
  if (!landlord?.auth_user_id || !landlord.tenant_id) {
    throw new Error("Test Landlord Co with auth_user_id not found");
  }

  console.log("Landlord:", tenant.name, landlord.landlord_type);
  console.log("auth_user_id:", landlord.auth_user_id);

  const { data: ua } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", landlord.auth_user_id)
    .maybeSingle();
  console.log(
    "In user_accounts?",
    ua?.auth_uid ? "yes (unexpected)" : "no (expected for landlord)",
  );

  const name = `FK verify ${new Date().toISOString()}`;
  const { data: inserted, error: insertError } = await admin
    .from("lessee_announcements")
    .insert({
      tenant_id: landlord.tenant_id,
      announcement_code: null,
      name,
      template_id: null,
      channels: ["in_app"],
      subject: null,
      body: "Schema verify draft — safe to delete.",
      audience_filter: { type: "all" },
      status: "draft",
      total_recipients: 0,
      created_by: landlord.auth_user_id,
    })
    .select("id, created_by, name")
    .single();

  if (insertError) {
    console.error("INSERT FAILED:", insertError.message);
    if (insertError.message.includes("lessee_announcements_created_by_fkey")) {
      console.error(
        "BLOCKED: script 147 not applied yet. Run scripts/147_lessee_announcements_created_by_dual_author.sql in Supabase SQL Editor.",
      );
      process.exit(2);
    }
    throw new Error(insertError.message);
  }

  console.log("INSERT OK:", inserted);
  const { error: delError } = await admin
    .from("lessee_announcements")
    .delete()
    .eq("id", inserted.id);
  if (delError) {
    console.warn("Cleanup delete failed:", delError.message);
  } else {
    console.log("Cleanup OK");
  }
  console.log("PASS: landlord auth_user_id accepted as created_by");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
