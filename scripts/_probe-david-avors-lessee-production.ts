/**
 * Read-only probe: david_avors@yahoo.com lessee / auth / lease state (production).
 *   npx tsx scripts/_probe-david-avors-lessee-production.ts --env-file .env.vercel.production.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const EMAIL = "david_avors@yahoo.com";
const PROD_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  console.log(`Loaded env: ${envFile}`);

  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    ""
  ).trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    ""
  ).trim();
  let hostHint = "(no-url)";
  try {
    hostHint = new URL(url).hostname;
  } catch {
    hostHint = `unparseable len=${url.length}`;
  }
  console.log(`Supabase host: ${hostHint}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  const isProd =
    hostHint.includes(PROD_REF) || hostHint.includes("tvcurcnmasnocwdxzgvz");
  const isStaging = hostHint.includes("wieflwbfdmjtsdnwbfii");
  if (!isProd && !isStaging) {
    // Still proceed — Vercel production env may use a custom domain.
    console.log(
      "WARN: host is neither known staging nor production project ref; continuing with this env.",
    );
  } else {
    console.log(isProd ? "Target: PRODUCTION" : "Target: STAGING");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("\n=== 1) lessees by email ===");
  const { data: lessees, error: lesseesErr } = await admin
    .from("lessees")
    .select(
      "tenant_id, lessee_id, full_name, email, phone, status, auth_user_id, created_at, updated_at",
    )
    .ilike("email", EMAIL);
  assert(!lesseesErr, lesseesErr?.message ?? "lessees query failed");
  console.log(JSON.stringify(lessees, null, 2));

  const tenantIds = [...new Set((lessees ?? []).map((r) => r.tenant_id))];
  const lesseeIds = (lessees ?? []).map((r) => r.lessee_id);
  const authUidsFromLessees = [
    ...new Set(
      (lessees ?? [])
        .map((r) => r.auth_user_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];

  console.log("\n=== landlords / tenants for those tenant_ids ===");
  if (tenantIds.length) {
    const { data: tenants } = await admin
      .from("tenants")
      .select("id, name, slug, product_line, status")
      .in("id", tenantIds);
    console.log("tenants:", JSON.stringify(tenants, null, 2));

    const { data: landlords } = await admin
      .from("landlords")
      .select(
        "tenant_id, auth_user_id, approval_status, landlord_type, created_at, updated_at",
      )
      .in("tenant_id", tenantIds);
    console.log("landlords:", JSON.stringify(landlords, null, 2));
  }

  console.log("\n=== leases for those lessee_ids ===");
  if (lesseeIds.length) {
    const { data: leases } = await admin
      .from("leases")
      .select(
        "tenant_id, lease_id, unit_id, lessee_id, status, start_date, end_date, terminated_at, updated_at, created_at",
      )
      .in("lessee_id", lesseeIds)
      .order("updated_at", { ascending: false });
    console.log(JSON.stringify(leases, null, 2));

    const unitIds = [
      ...new Set((leases ?? []).map((l) => l.unit_id).filter(Boolean)),
    ];
    if (unitIds.length) {
      const { data: units } = await admin
        .from("property_units")
        .select("tenant_id, unit_id, unit_number, property_id")
        .in("unit_id", unitIds);
      console.log("units:", JSON.stringify(units, null, 2));

      const propertyIds = [
        ...new Set((units ?? []).map((u) => u.property_id).filter(Boolean)),
      ];
      if (propertyIds.length) {
        const { data: properties } = await admin
          .from("properties")
          .select("tenant_id, property_id, property_name, name")
          .in("property_id", propertyIds);
        console.log("properties:", JSON.stringify(properties, null, 2));
      }
    }
  }

  console.log("\n=== 2) user_accounts by email ===");
  const { data: staffByEmail } = await admin
    .from("user_accounts")
    .select("auth_uid, tenant_id, email, role, is_active, created_at, updated_at")
    .ilike("email", EMAIL);
  console.log(JSON.stringify(staffByEmail, null, 2));

  console.log("\n=== 3) Auth user by email ===");
  let authUid: string | null = null;
  for (let page = 1; page <= 30 && !authUid; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      console.log("listUsers error:", error.message);
      break;
    }
    const match = (data?.users ?? []).find(
      (u) => u.email?.trim().toLowerCase() === EMAIL,
    );
    if (match) {
      authUid = match.id;
      console.log(
        JSON.stringify(
          {
            id: match.id,
            email: match.email,
            email_confirmed_at: match.email_confirmed_at,
            banned_until: (match as { banned_until?: string | null }).banned_until,
            user_metadata: match.user_metadata,
            app_metadata: match.app_metadata,
            created_at: match.created_at,
            updated_at: match.updated_at,
            last_sign_in_at: match.last_sign_in_at,
          },
          null,
          2,
        ),
      );
      break;
    }
    if (!data?.users?.length || data.users.length < 200) break;
  }
  if (!authUid) {
    console.log("No Auth user found for email via listUsers");
  }

  const allAuthUids = [
    ...new Set([
      ...authUidsFromLessees,
      ...(authUid ? [authUid] : []),
      ...(staffByEmail ?? []).map((r) => r.auth_uid),
    ]),
  ];

  console.log("\n=== user_accounts by auth_uid ===");
  if (allAuthUids.length) {
    const { data: staffByUid } = await admin
      .from("user_accounts")
      .select("auth_uid, tenant_id, email, role, is_active")
      .in("auth_uid", allAuthUids);
    console.log(JSON.stringify(staffByUid, null, 2));
  }

  console.log("\n=== landlords by auth_user_id ===");
  if (allAuthUids.length) {
    const { data: llByUid } = await admin
      .from("landlords")
      .select("tenant_id, auth_user_id, approval_status, landlord_type")
      .in("auth_user_id", allAuthUids);
    console.log(JSON.stringify(llByUid, null, 2));
  }

  console.log("\n=== lessees by auth_user_id (any status) ===");
  if (allAuthUids.length) {
    const { data: lesseesByAuth } = await admin
      .from("lessees")
      .select(
        "tenant_id, lessee_id, full_name, email, status, auth_user_id, updated_at",
      )
      .in("auth_user_id", allAuthUids);
    console.log(JSON.stringify(lesseesByAuth, null, 2));
  }

  console.log("\n=== 4) system_event_log around 23 Aug 2026 ===");
  const { data: events, error: eventsErr } = await admin
    .from("system_event_log")
    .select("id, event_type, entity_type, entity_id, tenant_id, payload, created_at")
    .gte("created_at", "2026-08-22T00:00:00Z")
    .lte("created_at", "2026-08-24T23:59:59Z")
    .or(
      `payload.ilike.%david_avors%,payload.ilike.%${lesseeIds[0] ?? "none"}%,entity_id.in.(${lesseeIds.join(",") || "00000000-0000-0000-0000-000000000000"})`,
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (eventsErr) {
    console.log("system_event_log error:", eventsErr.message);
    // fallback broader search
    const { data: events2, error: e2 } = await admin
      .from("system_event_log")
      .select("*")
      .gte("created_at", "2026-08-23T00:00:00Z")
      .lte("created_at", "2026-08-24T00:00:00Z")
      .limit(5);
    console.log("sample columns/error:", e2?.message, JSON.stringify(events2?.[0]));
  } else {
    console.log(JSON.stringify(events, null, 2));
  }

  // Also try user_activity_log
  console.log("\n=== user_activity_log for email Aug 23 ===");
  const { data: activity, error: actErr } = await admin
    .from("user_activity_log")
    .select("id, persona, event_name, status, email, auth_user_id, failure_reason, created_at, tenant_id")
    .ilike("email", EMAIL)
    .gte("created_at", "2026-08-22T00:00:00Z")
    .order("created_at", { ascending: false })
    .limit(30);
  if (actErr) console.log("activity error:", actErr.message);
  else console.log(JSON.stringify(activity, null, 2));

  // Find Test Managed Co / lease 004 specifically
  console.log("\n=== search Test Managed Co / lease 004 ===");
  const { data: managedTenants } = await admin
    .from("tenants")
    .select("id, name")
    .ilike("name", "%Test Managed%");
  console.log("tenants matching Test Managed:", JSON.stringify(managedTenants, null, 2));

  console.log("\nDONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
