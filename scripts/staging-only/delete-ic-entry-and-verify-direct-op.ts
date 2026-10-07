/**
 * Delete internal consumption via API (normal path) and verify Davors Facilities Oct Direct Operational.
 *
 * npx tsx scripts/staging-only/delete-ic-entry-and-verify-direct-op.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const ENTRY_ID = "2173e3c6-e5a2-4f71-b528-5d4534ccdc01";
const EXPECTED_OCT_DIRECT_OP = 1818.5;
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function davorsInventoryUser(admin: SupabaseClient) {
  const stamp = Date.now();
  const email = `r1.icdel.${stamp}@test.davors`;
  const password = `R1Ic-${stamp}!Aa9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser");
  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: DAVORS,
    role: "super_admin",
    is_active: true,
  });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({ email, password });
  return client;
}

async function sessionCookie(client: SupabaseClient) {
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("No session");
  const cookieProject = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  return `sb-${cookieProject}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: session.user,
    }),
  )}`;
}

async function sumFacilitiesDirectOpOct(admin: SupabaseClient): Promise<number> {
  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", DAVORS)
    .ilike("name", "%Facilities%")
    .maybeSingle();
  if (!bu?.id) throw new Error("Facilities BU not found");

  const { data: rows, error } = await admin
    .from("expense_register")
    .select("amount")
    .eq("tenant_id", DAVORS)
    .eq("business_unit_id", bu.id)
    .eq("expense_category", "Direct Operational")
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31");
  if (error) throw error;
  const sum = (rows ?? []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  return Math.round(sum * 100) / 100;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: entryExists } = await admin
    .from("internal_consumption")
    .select("id")
    .eq("id", ENTRY_ID)
    .maybeSingle();

  const before = await sumFacilitiesDirectOpOct(admin);
  console.log(`Facilities Oct Direct Operational before delete: ${before}`);

  if (!entryExists) {
    console.log("IC entry already absent (deleted earlier via normal path).");
    if (Math.abs(before - EXPECTED_OCT_DIRECT_OP) > 0.02) {
      throw new Error(`Expected ${EXPECTED_OCT_DIRECT_OP}, got ${before}`);
    }
    console.log(`PASS: Direct Operational Oct = ${before}`);
    return;
  }

  const user = await davorsInventoryUser(admin);
  const cookie = await sessionCookie(user);
  const delRes = await fetch(`${APP_URL}/api/inventory/internal-consumption/${ENTRY_ID}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  const delPayload = (await delRes.json()) as { error?: string; ok?: boolean };
  if (!delRes.ok) {
    throw new Error(delPayload.error ?? `DELETE failed ${delRes.status}`);
  }

  const { data: stillThere } = await admin
    .from("internal_consumption")
    .select("id")
    .eq("id", ENTRY_ID)
    .maybeSingle();
  if (stillThere) throw new Error("Entry still exists after delete");

  const after = await sumFacilitiesDirectOpOct(admin);
  console.log(`Facilities Oct Direct Operational after delete: ${after}`);

  if (Math.abs(after - EXPECTED_OCT_DIRECT_OP) > 0.02) {
    throw new Error(`Expected ${EXPECTED_OCT_DIRECT_OP}, got ${after}`);
  }

  console.log("PASS: IC entry deleted via API; Direct Operational Oct = 1,818.50");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
