/**
 * Staging regression: staff-created landlord auto-approve + portal invite path.
 *
 *   npx tsx scripts/test-staff-create-landlord-auto-approve-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  createTestPendingLandlord,
  onboardStaffCreatedLandlordForTest,
} from "./lib/landlord-test-helpers";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

type Cleanup = { tenantId: string | null };

async function cleanup(
  admin: ReturnType<typeof createClient>,
  state: Cleanup,
) {
  if (!state.tenantId) return;
  await admin
    .from("landlord_portal_invites")
    .delete()
    .eq("tenant_id", state.tenantId);
  await admin
    .from("landlord_subscriptions")
    .delete()
    .eq("tenant_id", state.tenantId);
  await admin.from("landlords").delete().eq("tenant_id", state.tenantId);
  await admin.from("tenants").delete().eq("id", state.tenantId);
  state.tenantId = null;
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
  const email = `landlord.staff.create.${stamp}@test.davors`;
  const name = `Staff Create Landlord Test ${stamp}`;
  const state: Cleanup = { tenantId: null };

  console.log("=== Staff create landlord auto-approve (staging) ===\n");

  try {
    state.tenantId = await createTestPendingLandlord(admin, {
      name,
      email,
      phone: "+233200000002",
      address: "Staff Create Test Address",
    });
    console.log("PASS — pending landlord tenant created");

    const { data: pendingRow } = await admin
      .from("landlords")
      .select("approval_status")
      .eq("tenant_id", state.tenantId)
      .single();
    assert(
      pendingRow?.approval_status === "pending",
      "Landlord should start pending before onboarding",
    );
    console.log("PASS — initial approval_status is pending");

    await onboardStaffCreatedLandlordForTest(admin, {
      tenantId: state.tenantId,
      email,
    });
    console.log("PASS — staff onboarding approved landlord + invite row");

    const { data: approvedRow } = await admin
      .from("landlords")
      .select("approval_status")
      .eq("tenant_id", state.tenantId)
      .single();
    assert(
      approvedRow?.approval_status === "approved",
      "Landlord row should be approved",
    );
    console.log("PASS — approval_status is approved");

    const { data: subscription } = await admin
      .from("landlord_subscriptions")
      .select("status")
      .eq("tenant_id", state.tenantId)
      .maybeSingle();
    assert(
      subscription?.status === "trialing",
      "Platform-only trial subscription should be seeded",
    );
    console.log("PASS — trial subscription seeded");

    const { data: invites } = await admin
      .from("landlord_portal_invites")
      .select("invite_id")
      .eq("tenant_id", state.tenantId);
    assert(
      (invites?.length ?? 0) >= 1,
      "Portal invite row should be created",
    );
    console.log("PASS — portal invite record created");

    console.log("\nAll staff create auto-approve staging checks passed.");
  } finally {
    await cleanup(admin, state);
    console.log("\nCleanup complete.");
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
