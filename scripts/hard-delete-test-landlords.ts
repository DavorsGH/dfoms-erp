/**
 * One-off: hard-delete test landlord tenants (real_estate_only only).
 *
 * Targets by tenants.name (must be product_line = 'real_estate_only'):
 *   - "Unifai"
 *   - "Caanta"
 *   - "Davors Facilities"
 *
 * SAFETY:
 *   - NEVER deletes DAVORS_TENANT_ID / platform tenant.
 *   - Refuses non-real_estate_only matches (e.g. ERP suite "Caanta").
 *   - Dry-run by default / with --dry-run; destructive only with --execute.
 *   - Stops if operational/financial dependents exist (properties, leases, etc.).
 *
 * Usage:
 *   npx tsx scripts/hard-delete-test-landlords.ts --dry-run
 *   npx tsx scripts/hard-delete-test-landlords.ts --execute
 *   npx tsx scripts/hard-delete-test-landlords.ts --env-file .env.staging.local --dry-run
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const TARGET_NAMES = ["Unifai", "Caanta", "Davors Facilities"] as const;

/**
 * Counts that indicate real operational/financial history → STOP.
 * short_links / landlord_portal_invites alone are treated as minimal residue
 * (e.g. staff SMS deep-links to /dashboard/real-estate/landlords/{id}).
 */
const UNEXPECTED_TABLES = [
  "properties",
  "property_units",
  "lessees",
  "leases",
  "rent_ledger",
  "escrow_ledger",
  "landlord_payouts",
  "maintenance_requests",
  "lessee_complaints",
  "lessee_announcements",
  "lessee_announcement_recipients",
  "lessee_notifications",
  "lessee_message_templates",
  "lessee_portal_invites",
  "sms_credit_transactions",
  "sms_credit_purchase_requests",
] as const;

/** Inspected always; non-zero alone may still be "minimal" (invites/subs). */
const INSPECT_TABLES = [
  ...UNEXPECTED_TABLES,
  "landlord_portal_invites",
  "landlord_subscriptions",
  "sms_credit_wallets",
  "billing_settings",
  "landlords",
  "tenants",
] as const;

/** Delete order: children before parents (tenant-scoped). */
const DELETE_ORDER = [
  "lessee_notifications",
  "lessee_announcement_recipients",
  "lessee_announcements",
  "lessee_message_templates",
  "lessee_complaints",
  "maintenance_requests",
  "landlord_payouts",
  "escrow_ledger",
  "rent_ledger",
  "lessee_portal_invites",
  "leases",
  "lessees",
  "property_units",
  "properties",
  "landlord_portal_invites",
  "landlord_subscriptions",
  "sms_credit_transactions",
  "sms_credit_purchase_requests",
  "sms_credit_wallets",
  "billing_settings",
  "landlords",
  "tenants",
] as const;

type CountMap = Record<string, number | "missing" | "error">;

function loadEnvForce(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let v = trimmed.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = v;
  }
}

async function countByTenant(
  admin: SupabaseClient,
  table: string,
  tenantId: string,
  column: "tenant_id" | "id" = "tenant_id",
): Promise<number | "missing" | "error"> {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, tenantId);

  if (error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("does not exist") ||
      msg.includes("could not find") ||
      msg.includes("schema cache")
    ) {
      return "missing";
    }
    console.warn(`  count ${table}: ${error.message}`);
    return "error";
  }
  return count ?? 0;
}

async function inspectTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<CountMap> {
  const counts: CountMap = {};
  for (const table of INSPECT_TABLES) {
    if (table === "tenants") {
      counts[table] = await countByTenant(admin, table, tenantId, "id");
    } else {
      counts[table] = await countByTenant(admin, table, tenantId, "tenant_id");
    }
  }

  // short_links has no tenant_id — report presence via destination containing tenant id
  const { count: shortLinkCount, error: shortErr } = await admin
    .from("short_links")
    .select("*", { count: "exact", head: true })
    .ilike("destination_url", `%${tenantId}%`);
  if (shortErr) {
    const msg = shortErr.message.toLowerCase();
    counts.short_links_by_tenant_in_url =
      msg.includes("does not exist") || msg.includes("could not find")
        ? "missing"
        : "error";
  } else {
    counts.short_links_by_tenant_in_url = shortLinkCount ?? 0;
  }

  return counts;
}

function unexpectedFindings(counts: CountMap): string[] {
  const hits: string[] = [];
  for (const table of UNEXPECTED_TABLES) {
    const n = counts[table];
    if (typeof n === "number" && n > 0) {
      hits.push(`${table}=${n}`);
    }
  }
  return hits;
}

type TargetRow = {
  tenant_id: string;
  name: string;
  email: string | null;
  product_line: string | null;
  status: string | null;
  landlord_type: string | null;
  approval_status: string | null;
  auth_user_id: string | null;
  is_platform_davors: boolean;
  counts: CountMap;
  unexpected: string[];
  safe_to_delete: boolean;
  block_reason: string | null;
};

async function resolveTargets(admin: SupabaseClient): Promise<TargetRow[]> {
  const out: TargetRow[] = [];

  for (const name of TARGET_NAMES) {
    // Also surface non-RE collisions for the report (do not delete them).
    const { data: allNamed, error: allErr } = await admin
      .from("tenants")
      .select("id, name, email, product_line, status")
      .eq("name", name);

    if (allErr) {
      throw new Error(`Lookup ${name}: ${allErr.message}`);
    }

    const reOnly = (allNamed ?? []).filter(
      (t) => t.product_line === "real_estate_only",
    );
    const others = (allNamed ?? []).filter(
      (t) => t.product_line !== "real_estate_only",
    );

    if (others.length > 0) {
      console.log(
        `NOTE: "${name}" also matches non-real_estate_only tenant(s) — will NOT touch:`,
        others.map((t) => ({
          id: t.id,
          product_line: t.product_line,
          is_platform: t.id === DAVORS_TENANT_ID,
        })),
      );
    }

    if (reOnly.length === 0) {
      out.push({
        tenant_id: "",
        name,
        email: null,
        product_line: null,
        status: null,
        landlord_type: null,
        approval_status: null,
        auth_user_id: null,
        is_platform_davors: false,
        counts: {},
        unexpected: [],
        safe_to_delete: false,
        block_reason: "No real_estate_only landlord tenant with this name",
      });
      continue;
    }

    if (reOnly.length > 1) {
      out.push({
        tenant_id: reOnly.map((t) => t.id).join(","),
        name,
        email: null,
        product_line: "real_estate_only",
        status: null,
        landlord_type: null,
        approval_status: null,
        auth_user_id: null,
        is_platform_davors: reOnly.some((t) => t.id === DAVORS_TENANT_ID),
        counts: {},
        unexpected: [],
        safe_to_delete: false,
        block_reason: `Ambiguous: ${reOnly.length} real_estate_only tenants named "${name}"`,
      });
      continue;
    }

    const tenant = reOnly[0]!;
    const isPlatform = tenant.id === DAVORS_TENANT_ID;

    const { data: landlord, error: landlordErr } = await admin
      .from("landlords")
      .select("tenant_id, landlord_type, approval_status, auth_user_id")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    if (landlordErr) {
      throw new Error(`landlords ${name}: ${landlordErr.message}`);
    }

    const counts = await inspectTenant(admin, tenant.id);
    const unexpected = unexpectedFindings(counts);

    let block_reason: string | null = null;
    if (isPlatform) {
      block_reason =
        "CRITICAL: matches DAVORS_TENANT_ID platform tenant — refuse delete";
    } else if (!landlord) {
      block_reason = "No landlords row for this tenant";
    } else if (unexpected.length > 0) {
      block_reason = `Unexpected dependent data: ${unexpected.join(", ")}`;
    }

    out.push({
      tenant_id: tenant.id,
      name: tenant.name,
      email: tenant.email,
      product_line: tenant.product_line,
      status: tenant.status,
      landlord_type: landlord?.landlord_type ?? null,
      approval_status: landlord?.approval_status ?? null,
      auth_user_id: landlord?.auth_user_id ?? null,
      is_platform_davors: isPlatform,
      counts,
      unexpected,
      safe_to_delete: block_reason === null,
      block_reason,
    });
  }

  return out;
}

async function deleteTenantCascade(
  admin: SupabaseClient,
  tenantId: string,
  authUserId: string | null,
): Promise<Record<string, number | string>> {
  const removed: Record<string, number | string> = {};

  for (const table of DELETE_ORDER) {
    if (table === "tenants") {
      const { data, error } = await admin
        .from("tenants")
        .delete()
        .eq("id", tenantId)
        .select("id");
      if (error) throw new Error(`delete tenants: ${error.message}`);
      removed[table] = data?.length ?? 0;
      continue;
    }

    const { data, error } = await admin
      .from(table)
      .delete()
      .eq("tenant_id", tenantId)
      .select("*");

    if (error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("does not exist") ||
        msg.includes("could not find") ||
        msg.includes("schema cache")
      ) {
        removed[table] = "missing";
        continue;
      }
      throw new Error(`delete ${table}: ${error.message}`);
    }
    removed[table] = data?.length ?? 0;
  }

  // short_links matching tenant id in destination
  const { data: shortDeleted, error: shortErr } = await admin
    .from("short_links")
    .delete()
    .ilike("destination_url", `%${tenantId}%`)
    .select("code");
  if (shortErr) {
    const msg = shortErr.message.toLowerCase();
    removed.short_links =
      msg.includes("does not exist") || msg.includes("could not find")
        ? "missing"
        : `error:${shortErr.message}`;
  } else {
    removed.short_links = shortDeleted?.length ?? 0;
  }

  if (authUserId) {
    const { error: authErr } = await admin.auth.admin.deleteUser(authUserId);
    if (authErr) {
      removed.auth_users = `error:${authErr.message}`;
    } else {
      removed.auth_users = 1;
    }
  } else {
    removed.auth_users = 0;
  }

  return removed;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const dryRun = !execute || args.includes("--dry-run");
  if (execute && args.includes("--dry-run")) {
    throw new Error("Pass either --dry-run or --execute, not both.");
  }

  const envIdx = args.indexOf("--env-file");
  const envFile =
    envIdx >= 0 && args[envIdx + 1] ? args[envIdx + 1]! : ".env.staging.local";
  loadEnvForce(resolve(process.cwd(), envFile));

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!supabaseUrl.includes(STAGING_REF)) {
    throw new Error(
      `Refusing non-staging Supabase URL (expected ref ${STAGING_REF})`,
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Hard-delete test landlords ===");
  console.log("Mode:", dryRun ? "DRY-RUN (no deletes)" : "EXECUTE (destructive)");
  console.log("Env file:", envFile);
  console.log("Supabase:", supabaseUrl);
  console.log("DAVORS_TENANT_ID:", DAVORS_TENANT_ID);
  console.log("Targets:", TARGET_NAMES.join(", "));
  console.log("");

  // Platform tenant sanity
  const { data: platform, error: platformErr } = await admin
    .from("tenants")
    .select("id, name, product_line, status")
    .eq("id", DAVORS_TENANT_ID)
    .maybeSingle();
  if (platformErr) throw new Error(platformErr.message);
  console.log("Platform tenant row:", platform);
  console.log("");

  const targets = await resolveTargets(admin);

  for (const t of targets) {
    console.log("-----");
    console.log(JSON.stringify(t, null, 2));
  }
  console.log("-----");

  const blocked = targets.filter((t) => !t.safe_to_delete);
  const safe = targets.filter((t) => t.safe_to_delete);

  console.log("\nSummary:");
  console.log(`  safe_to_delete: ${safe.length}`);
  console.log(`  blocked: ${blocked.length}`);
  for (const b of blocked) {
    console.log(`  - BLOCK "${b.name}": ${b.block_reason}`);
  }

  if (dryRun) {
    console.log("\nDRY-RUN complete. Re-run with --execute to delete safe targets.");
    if (blocked.length > 0 && safe.length === 0) {
      console.log("Nothing is safe to delete.");
    }
    return;
  }

  // EXECUTE path
  if (blocked.length > 0) {
    console.error(
      "\nSTOP: one or more targets have unexpected data or safety blocks.",
    );
    console.error("No rows were deleted. Fix/confirm and re-run dry-run first.");
    process.exitCode = 1;
    return;
  }

  if (safe.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  console.log("\nExecuting deletes for safe targets...");
  for (const t of safe) {
    if (t.tenant_id === DAVORS_TENANT_ID) {
      throw new Error("Refusing to delete DAVORS_TENANT_ID");
    }
    if (t.product_line !== "real_estate_only") {
      throw new Error(`Refusing non-RE tenant ${t.tenant_id}`);
    }

    console.log(`\nDeleting "${t.name}" (${t.tenant_id})...`);
    const removed = await deleteTenantCascade(
      admin,
      t.tenant_id,
      t.auth_user_id,
    );
    console.log("Removed:", JSON.stringify(removed, null, 2));

    // Verify gone
    const { data: stillTenant } = await admin
      .from("tenants")
      .select("id")
      .eq("id", t.tenant_id)
      .maybeSingle();
    const { data: stillLandlord } = await admin
      .from("landlords")
      .select("tenant_id")
      .eq("tenant_id", t.tenant_id)
      .maybeSingle();
    console.log("Verify tenants gone:", stillTenant == null);
    console.log("Verify landlords gone:", stillLandlord == null);
  }

  console.log("\nEXECUTE complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
