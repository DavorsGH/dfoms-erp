import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

loadEnvFromArgv(["--env-file", ".env.local"]);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: props } = await admin
    .from("properties")
    .select("property_id, property_name, name, tenant_id")
    .in("property_id", [
      "c68a4bb4-60c4-4653-a3ab-c1e503017bec",
      "2173eeb6-acdd-4c62-9c3a-ddc305a80522",
    ]);
  console.log("properties", JSON.stringify(props, null, 2));

  const { data: act, error: actErr } = await admin
    .from("user_activity_log")
    .select("*")
    .ilike("email", "david_avors@yahoo.com")
    .gte("created_at", "2026-08-22T00:00:00Z")
    .order("created_at", { ascending: false })
    .limit(20);
  console.log("activity err", actErr?.message ?? null);
  console.log("activity", JSON.stringify(act, null, 2));

  const { data: active } = await admin
    .from("leases")
    .select("lease_id, status, unit_id")
    .eq("tenant_id", "444e2a9c-6164-4450-bfbd-4863da5fecec")
    .eq("lessee_id", "6807c3f3-df5f-46b1-8194-87e093de6765")
    .eq("status", "active");
  console.log("remaining active Test Managed leases", active);

  const { data: inv } = await admin
    .from("lessee_portal_invites")
    .select(
      "invite_id, tenant_id, lessee_id, email, used_at, expires_at, created_at",
    )
    .ilike("email", "david_avors@yahoo.com")
    .order("created_at", { ascending: false })
    .limit(10);
  console.log("invites", JSON.stringify(inv, null, 2));

  // cross-persona style: other lessees with same email excluding each id
  for (const id of [
    "6807c3f3-df5f-46b1-8194-87e093de6765",
    "eacd9aeb-b5b8-4a13-b14d-5a42dede3d7e",
  ]) {
    const { data } = await admin
      .from("lessees")
      .select("lessee_id, tenant_id, status, auth_user_id, email")
      .ilike("email", "david_avors@yahoo.com")
      .neq("lessee_id", id);
    console.log(`duplicates excluding ${id}:`, JSON.stringify(data, null, 2));
  }
}

main();
