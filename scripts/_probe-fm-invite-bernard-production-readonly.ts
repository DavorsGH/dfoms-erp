/**
 * READ-ONLY production probe: FM invite for david.avors@davorsfacilities.com
 * under Bernard Anagbonu Residence. Does not mutate data.
 *
 *   npx tsx scripts/_probe-fm-invite-bernard-production-readonly.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const FM_EMAIL = "david.avors@davorsfacilities.com";
const LANDLORD_NAME_HINT = "Bernard Anagbonu";
const RAW_TOKEN_FROM_SCREENSHOT =
  "5b85775389734adf583e3790a3708104edbd7d3731b67f5952839f5983b398c0";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function loadProductionEnv() {
  for (const file of [".env.local.backup", ".env.vercel.production.local"]) {
    try {
      loadEnvForce(resolve(process.cwd(), file));
      return file;
    } catch {
      /* next */
    }
  }
  throw new Error("Missing production env");
}

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function main() {
  const envFile = loadProductionEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const ref = url ? new URL(url).hostname.split(".")[0] : "";
  if (ref !== PRODUCTION_REF || !serviceKey) {
    throw new Error(`Expected production ${PRODUCTION_REF}, got ${ref} via ${envFile}`);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Production readonly FM invite probe ===");
  console.log("env:", envFile, "ref:", ref);

  // Find Bernard tenant / landlord
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name")
    .ilike("name", `%${LANDLORD_NAME_HINT}%`);
  console.log("\nTenants matching Bernard:", tenants);

  const tenantIds = (tenants ?? []).map((t) => t.id as string);

  const { data: landlords } = tenantIds.length
    ? await admin
        .from("landlords")
        .select(
          "landlord_id, tenant_id, full_name, email, auth_user_id, landlord_type, approval_status",
        )
        .in("tenant_id", tenantIds)
    : { data: [] };

  console.log("Landlords for those tenants:");
  for (const l of landlords ?? []) {
    console.log({
      landlord_id: l.landlord_id,
      tenant_id: l.tenant_id,
      full_name: l.full_name,
      email: l.email,
      auth_user_id: l.auth_user_id,
      landlord_type: l.landlord_type,
      approval_status: l.approval_status,
    });
  }

  // FM rows for this email
  const { data: fms } = await admin
    .from("facility_managers")
    .select(
      "facility_manager_id, tenant_id, full_name, email, status, auth_user_id, invited_at, activated_at, created_at",
    )
    .eq("email", FM_EMAIL.toLowerCase())
    .order("created_at", { ascending: false });

  console.log("\nfacility_managers for", FM_EMAIL, ":", fms);

  const fmIds = (fms ?? []).map((f) => f.facility_manager_id as string);
  const { data: invites } = fmIds.length
    ? await admin
        .from("facility_manager_portal_invites")
        .select(
          "invite_id, tenant_id, facility_manager_id, email, token_hash, expires_at, used_at, created_at",
        )
        .in("facility_manager_id", fmIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  console.log("\nfacility_manager_portal_invites:");
  for (const inv of invites ?? []) {
    console.log({
      invite_id: inv.invite_id,
      tenant_id: inv.tenant_id,
      facility_manager_id: inv.facility_manager_id,
      email: inv.email,
      token_hash_prefix: String(inv.token_hash).slice(0, 12) + "…",
      expires_at: inv.expires_at,
      used_at: inv.used_at,
      created_at: inv.created_at,
      expired: new Date(String(inv.expires_at)).getTime() < Date.now(),
      still_live: !inv.used_at && new Date(String(inv.expires_at)).getTime() >= Date.now(),
    });
  }

  // Does screenshot token hash match any invite?
  const screenshotHash = sha256Hex(RAW_TOKEN_FROM_SCREENSHOT);
  console.log("\nScreenshot token sha256 prefix:", screenshotHash.slice(0, 16) + "…");
  const match = (invites ?? []).find(
    (inv) => String(inv.token_hash).toLowerCase() === screenshotHash.toLowerCase(),
  );
  console.log(
    "Screenshot token matches invite:",
    match
      ? {
          invite_id: match.invite_id,
          used_at: match.used_at,
          expires_at: match.expires_at,
          still_live: !match.used_at && new Date(String(match.expires_at)).getTime() >= Date.now(),
        }
      : "NO MATCH in FM invites for this email",
  );

  // Also search all invites by hash (in case email mismatch)
  const { data: byHash } = await admin
    .from("facility_manager_portal_invites")
    .select(
      "invite_id, tenant_id, facility_manager_id, email, expires_at, used_at, created_at",
    )
    .eq("token_hash", screenshotHash)
    .maybeSingle();
  console.log("Invite lookup by screenshot token_hash:", byHash ?? "not found");

  // Is FM_EMAIL also a landlord auth identity?
  const { data: landlordsByEmail } = await admin
    .from("landlords")
    .select(
      "landlord_id, tenant_id, full_name, email, auth_user_id, landlord_type, approval_status",
    )
    .ilike("email", FM_EMAIL);

  console.log("\nlandlords with email", FM_EMAIL, ":", landlordsByEmail);

  // Auth user for this email
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  // Prefer getUserByEmail if available — Supabase JS may not have it; scan
  let authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null =
    null;
  // Use generateLink / list is heavy — try RPC-less: invite email lookup via auth.users not exposed.
  // Attempt listUsers filter isn't supported; use admin.getUserById if we have auth_user_id from landlord/fm.

  const authIds = new Set<string>();
  for (const l of landlordsByEmail ?? []) {
    if (l.auth_user_id) authIds.add(l.auth_user_id as string);
  }
  for (const f of fms ?? []) {
    if (f.auth_user_id) authIds.add(f.auth_user_id as string);
  }
  for (const l of landlords ?? []) {
    if (l.auth_user_id) authIds.add(l.auth_user_id as string);
  }

  console.log("\nAuth users linked:");
  for (const id of authIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    const u = data.user;
    if (!u) {
      console.log({ id, missing: true });
      continue;
    }
    console.log({
      id: u.id,
      email: u.email,
      portal_meta: u.user_metadata?.portal ?? null,
      banned_until: (u as { banned_until?: string | null }).banned_until ?? null,
      last_sign_in_at: u.last_sign_in_at,
      created_at: u.created_at,
    });
    if (u.email?.toLowerCase() === FM_EMAIL.toLowerCase()) {
      authUser = u;
    }
  }

  // Cross-check: landlord invite tokens for same raw token (wrong table)?
  try {
    const { data: landlordInv } = await admin
      .from("landlord_portal_invites")
      .select("invite_id, tenant_id, email, expires_at, used_at, created_at")
      .eq("token_hash", screenshotHash)
      .maybeSingle();
    console.log("\nlandlord_portal_invites by same hash:", landlordInv ?? "not found");
  } catch (e) {
    console.log("\nlandlord_portal_invites lookup error:", String(e));
  }

  void listed;
  void authUser;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
