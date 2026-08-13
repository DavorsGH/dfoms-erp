/**
 * Remove Phase 3 / landlord-signature disposable test landlords from production.
 *
 * Targets (fixed tenant IDs + name verification):
 *   - Phase 3 Prod Email Test Landlord (2a4a3e18-31eb-4744-a3f2-35ece4f27d2c)
 *   - Phase 3 Prod Davors Managed Test (2ca75317-0eb9-45c2-8c7a-8aaa181dd513)
 *
 * Usage:
 *   npx tsx scripts/cleanup-phase3-prod-test-landlords.ts --dry-run
 *   npx tsx scripts/cleanup-phase3-prod-test-landlords.ts --execute
 */
// @ts-nocheck
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PRODUCTION_ENV = ".env.local.backup";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

const TARGETS = [
  {
    tenantId: "2a4a3e18-31eb-4744-a3f2-35ece4f27d2c",
    expectedName: "Phase 3 Prod Email Test Landlord",
  },
  {
    tenantId: "2ca75317-0eb9-45c2-8c7a-8aaa181dd513",
    expectedName: "Phase 3 Prod Davors Managed Test",
  },
] as const;

/** Tenant-scoped tables, children before parents. */
const DELETE_ORDER = [
  "landlord_notifications",
  "lessee_notifications",
  "lessee_announcement_recipients",
  "lessee_announcements",
  "lessee_message_templates",
  "lessee_complaints",
  "maintenance_requests",
  "landlord_payouts",
  "landlord_unit_activation_charges",
  "escrow_ledger",
  "rent_ledger",
  "security_deposits",
  "rental_applications",
  "rental_application_links",
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

const INSPECT_TABLES = DELETE_ORDER.filter((t) => t !== "tenants");

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

function supabaseRef(url: string) {
  const m = /^https?:\/\/([^.]+)\.supabase\.co/.exec((url ?? "").trim());
  return m ? m[1] : "(invalid)";
}

async function countByTenant(
  admin: SupabaseClient,
  table: string,
  tenantId: string,
): Promise<number | "missing" | "error"> {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("does not exist") ||
      msg.includes("could not find") ||
      msg.includes("schema cache")
    ) {
      return "missing";
    }
    return "error";
  }
  return count ?? 0;
}

async function inspectTenant(admin: SupabaseClient, tenantId: string) {
  const counts: Record<string, number | "missing" | "error"> = {};
  for (const table of INSPECT_TABLES) {
    counts[table] = await countByTenant(admin, table, tenantId);
  }

  const { count: shortLinks, error: shortErr } = await admin
    .from("short_links")
    .select("*", { count: "exact", head: true })
    .ilike("destination_url", `%${tenantId}%`);
  counts.short_links = shortErr ? "error" : (shortLinks ?? 0);

  const { count: crmSubs, error: crmErr } = await admin
    .from("crm_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("linked_tenant_id", tenantId);
  counts.crm_subscriptions_linked = crmErr ? "missing" : (crmSubs ?? 0);

  const { data: escrowRows } = await admin
    .from("escrow_ledger")
    .select("amount_ghs, entry_type")
    .eq("tenant_id", tenantId);
  const escrowNet =
    (escrowRows ?? []).reduce(
      (sum, row) => sum + Number(row.amount_ghs ?? 0),
      0,
    ) || 0;

  return { counts, escrowNet, escrowRowCount: escrowRows?.length ?? 0 };
}

async function checkExternalReferences(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const blocks: string[] = [];

  const { count: crmCount, error: crmErr } = await admin
    .from("crm_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("linked_tenant_id", tenantId);
  if (!crmErr && (crmCount ?? 0) > 0) {
    blocks.push(`crm_subscriptions.linked_tenant_id=${crmCount}`);
  }

  const { data: leaseIds } = await admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", tenantId);
  const ids = (leaseIds ?? []).map((r) => r.lease_id);
  if (ids.length > 0) {
    const { count: crossRent } = await admin
      .from("rent_ledger")
      .select("*", { count: "exact", head: true })
      .in("lease_id", ids)
      .neq("tenant_id", tenantId);
    if ((crossRent ?? 0) > 0) {
      blocks.push(`rent_ledger rows on these leases from other tenants=${crossRent}`);
    }

    const { count: crossDeposits } = await admin
      .from("security_deposits")
      .select("*", { count: "exact", head: true })
      .in("lease_id", ids)
      .neq("tenant_id", tenantId);
    if ((crossDeposits ?? 0) > 0) {
      blocks.push(
        `security_deposits rows on these leases from other tenants=${crossDeposits}`,
      );
    }
  }

  const { count: davorsPayoutRefs, error: payoutErr } = await admin
    .from("landlord_payouts")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", DAVORS_TENANT_ID)
    .filter("notes", "ilike", `%${tenantId}%`);
  if (!payoutErr && (davorsPayoutRefs ?? 0) > 0) {
    blocks.push(`possible Davors payout notes referencing tenant=${davorsPayoutRefs}`);
  }

  return blocks;
}

async function deleteTenantCascade(
  admin: SupabaseClient,
  tenantId: string,
  authUserId: string | null,
) {
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

  const { data: shortDeleted, error: shortErr } = await admin
    .from("short_links")
    .delete()
    .ilike("destination_url", `%${tenantId}%`)
    .select("code");
  removed.short_links = shortErr ? "missing" : (shortDeleted?.length ?? 0);

  const storagePaths = [
    `${tenantId}/landlord-logo.png`,
    `${tenantId}/landlord-signature.png`,
    `${tenantId}/logo.png`,
    `${tenantId}/signature.png`,
  ];
  const { data: listed } = await admin.storage
    .from("tenant-logos")
    .list(tenantId, { limit: 100 });
  const listPaths = (listed ?? []).map((f) => `${tenantId}/${f.name}`);
  const allPaths = [...new Set([...storagePaths, ...listPaths])];
  if (allPaths.length > 0) {
    const { data: storageRemoved, error: storageErr } = await admin.storage
      .from("tenant-logos")
      .remove(allPaths);
    removed.tenant_logos_storage = storageErr
      ? `error:${storageErr.message}`
      : (storageRemoved?.length ?? 0);
  } else {
    removed.tenant_logos_storage = 0;
  }

  if (authUserId) {
    const { error: authErr } = await admin.auth.admin.deleteUser(authUserId);
    removed.auth_users = authErr ? `error:${authErr.message}` : 1;
  } else {
    removed.auth_users = 0;
  }

  return removed;
}

async function verifyGone(admin: SupabaseClient, tenantId: string) {
  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  const { data: landlord } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const residual: Record<string, number> = {};
  for (const table of INSPECT_TABLES) {
    const n = await countByTenant(admin, table, tenantId);
    if (typeof n === "number" && n > 0) {
      residual[table] = n;
    }
  }

  return {
    tenantGone: tenant == null,
    landlordGone: landlord == null,
    residual,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const dryRun = !execute || args.includes("--dry-run");
  if (execute && args.includes("--dry-run")) {
    throw new Error("Pass either --dry-run or --execute, not both.");
  }

  loadEnvForce(resolve(PRODUCTION_ENV));
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const ref = supabaseRef(supabaseUrl);
  if (ref !== PRODUCTION_REF) {
    throw new Error(`Refusing: expected ${PRODUCTION_REF}, got ${ref}`);
  }
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase env vars");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Phase 3 production test landlord cleanup ===");
  console.log("Mode:", dryRun ? "DRY-RUN" : "EXECUTE");
  console.log("Env:", PRODUCTION_ENV);
  console.log("Supabase ref:", ref);
  console.log("");

  const report: Array<{
    tenantId: string;
    name: string;
    inspection: Awaited<ReturnType<typeof inspectTenant>>;
    externalBlocks: string[];
    safe: boolean;
    blockReason: string | null;
    authUserId: string | null;
    removed?: Record<string, number | string>;
    verify?: Awaited<ReturnType<typeof verifyGone>>;
  }> = [];

  for (const target of TARGETS) {
    if (target.tenantId === DAVORS_TENANT_ID) {
      throw new Error("Refusing to touch DAVORS_TENANT_ID");
    }

    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .select("id, name, email, product_line, status")
      .eq("id", target.tenantId)
      .maybeSingle();
    if (tenantErr) throw new Error(tenantErr.message);

    let blockReason: string | null = null;
    if (!tenant) {
      blockReason = "Tenant row not found (already deleted?)";
    } else if (tenant.product_line !== "real_estate_only") {
      blockReason = `Unexpected product_line=${tenant.product_line}`;
    } else if (tenant.name !== target.expectedName) {
      blockReason = `Name mismatch: expected "${target.expectedName}", got "${tenant.name}"`;
    }

    const { data: landlord } = await admin
      .from("landlords")
      .select("tenant_id, landlord_type, approval_status, auth_user_id")
      .eq("tenant_id", target.tenantId)
      .maybeSingle();

    const inspection = tenant
      ? await inspectTenant(admin, target.tenantId)
      : { counts: {}, escrowNet: 0, escrowRowCount: 0 };
    const externalBlocks = tenant
      ? await checkExternalReferences(admin, target.tenantId)
      : [];

    if (externalBlocks.length > 0) {
      blockReason = blockReason ?? `External references: ${externalBlocks.join("; ")}`;
    }

    report.push({
      tenantId: target.tenantId,
      name: tenant?.name ?? target.expectedName,
      inspection,
      externalBlocks,
      safe: blockReason === null,
      blockReason,
      authUserId: landlord?.auth_user_id ?? null,
    });
  }

  for (const row of report) {
    console.log("-----");
    console.log(`Tenant: ${row.name}`);
    console.log(`ID: ${row.tenantId}`);
    console.log("Counts:", JSON.stringify(row.inspection.counts, null, 2));
    console.log(
      `Escrow: rows=${row.inspection.escrowRowCount} net_ghs=${row.inspection.escrowNet}`,
    );
    console.log("External blocks:", row.externalBlocks.length ? row.externalBlocks : "(none)");
    console.log("Safe to delete:", row.safe);
    if (row.blockReason) console.log("Block reason:", row.blockReason);
  }
  console.log("-----");

  const blocked = report.filter((r) => !r.safe);
  const safe = report.filter((r) => r.safe);

  if (dryRun) {
    console.log("\nDRY-RUN complete.");
    console.log(`  safe: ${safe.length}, blocked: ${blocked.length}`);
    if (blocked.every((b) => b.blockReason?.includes("not found"))) {
      console.log("All targets already removed.");
    }
    return;
  }

  if (blocked.length > 0) {
    console.error("\nSTOP: blocked targets remain. No deletes executed.");
    process.exitCode = 1;
    return;
  }

  console.log("\nExecuting deletes...");
  for (const row of safe) {
    console.log(`\nDeleting ${row.name} (${row.tenantId})...`);
    row.removed = await deleteTenantCascade(
      admin,
      row.tenantId,
      row.authUserId,
    );
    console.log("Removed:", JSON.stringify(row.removed, null, 2));
    row.verify = await verifyGone(admin, row.tenantId);
    console.log("Verify:", JSON.stringify(row.verify, null, 2));
  }

  const { data: remainingRe } = await admin
    .from("tenants")
    .select("id, name")
    .eq("product_line", "real_estate_only")
    .in("name", TARGETS.map((t) => t.expectedName));

  console.log("\n=== EXECUTE complete ===");
  console.log(
    "Remaining real_estate_only tenants with test names:",
    remainingRe?.length ? remainingRe : "(none)",
  );
  console.log(
    "Remaining rows for target IDs:",
    JSON.stringify(
      report.map((r) => ({
        tenantId: r.tenantId,
        verify: r.verify,
        removed: r.removed,
      })),
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
