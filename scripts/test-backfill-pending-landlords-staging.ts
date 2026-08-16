/**
 * Staging regression: pending landlord backfill script (dry-run + execute + idempotent).
 *
 *   npx tsx scripts/test-backfill-pending-landlords-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  approveLandlordForTest,
  createTestPendingLandlord,
} from "./lib/landlord-test-helpers";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

type Cleanup = { tenantIds: string[] };

async function countPending(
  admin: ReturnType<typeof createClient>,
  tenantIds: string[],
) {
  const { count, error } = await admin
    .from("landlords")
    .select("tenant_id", { count: "exact", head: true })
    .in("tenant_id", tenantIds)
    .eq("approval_status", "pending");
  assert(!error, error?.message ?? "pending count failed");
  return count ?? 0;
}

async function cleanup(
  admin: ReturnType<typeof createClient>,
  state: Cleanup,
) {
  for (const tenantId of state.tenantIds) {
    await admin
      .from("landlord_subscriptions")
      .delete()
      .eq("tenant_id", tenantId);
    await admin.from("landlords").delete().eq("tenant_id", tenantId);
    await admin.from("tenants").delete().eq("id", tenantId);
  }
  state.tenantIds = [];
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url.includes(STAGING_REF), "Expected staging Supabase URL in env");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now();
  const state: Cleanup = { tenantIds: [] };

  console.log("=== Backfill pending landlords (staging test) ===\n");

  try {
    state.tenantIds.push(
      await createTestPendingLandlord(admin, {
        name: `Backfill Pending A ${stamp}`,
        email: `backfill.pending.a.${stamp}@test.davors`,
        phone: "+233200000004",
        address: "Backfill Test Address A",
      }),
    );
    state.tenantIds.push(
      await createTestPendingLandlord(admin, {
        name: `Backfill Pending B ${stamp}`,
        email: `backfill.pending.b.${stamp}@test.davors`,
        phone: "+233200000005",
        address: "Backfill Test Address B",
      }),
    );
    console.log("PASS — created two pending landlords");

    const pendingBefore = await countPending(admin, state.tenantIds);
    assert(pendingBefore === 2, `Expected 2 pending, got ${pendingBefore}`);
    console.log("PASS — dry-run candidate count is 2");

    let approved = 0;
    for (const tenantId of state.tenantIds) {
      const result = await approveLandlordForTest(admin, tenantId);
      if (result.transitioned) approved += 1;
    }
    assert(approved === 2, "Both landlords should transition on first execute");
    console.log("PASS — execute path approved both landlords");

    const pendingAfter = await countPending(admin, state.tenantIds);
    assert(pendingAfter === 0, `Expected 0 pending after execute, got ${pendingAfter}`);
    console.log("PASS — no pending rows remain for test tenants");

    let secondRunTransitions = 0;
    for (const tenantId of state.tenantIds) {
      const result = await approveLandlordForTest(admin, tenantId);
      if (result.transitioned) secondRunTransitions += 1;
    }
    assert(
      secondRunTransitions === 0,
      "Second backfill run should be idempotent",
    );
    console.log("PASS — idempotent second run");

    const { count: inviteCount, error: inviteError } = await admin
      .from("landlord_portal_invites")
      .select("invite_id", { count: "exact", head: true })
      .in("tenant_id", state.tenantIds);
    assert(!inviteError, inviteError?.message ?? "invite count failed");
    assert(
      (inviteCount ?? 0) === 0,
      "Backfill approve-only must not create portal invites",
    );
    console.log("PASS — no portal invites created by backfill");

    console.log("\nAll backfill staging checks passed.");
  } finally {
    await cleanup(admin, state);
    console.log("\nCleanup complete.");
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
