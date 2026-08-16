/**
 * Phase 4: approve legacy pending landlords (approve-only — no portal invites).
 *
 * Default is dry-run. Production requires --allow-production.
 *
 *   npx tsx scripts/backfill-pending-landlords-approval.ts --env-file .env.staging.local
 *   npx tsx scripts/backfill-pending-landlords-approval.ts --env-file .env.staging.local --execute
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";
import { assert, loadEnvFromArgv } from "./lib/env";
import { approveLandlordForTest } from "./lib/landlord-test-helpers";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

type PendingRow = {
  tenant_id: string;
  approval_status: string;
  landlord_type: string | null;
  auth_user_id: string | null;
  tenants: {
    name: string;
    email: string | null;
    created_at: string;
  } | null;
};

async function fetchPendingLandlords(
  admin: SupabaseClient,
): Promise<PendingRow[]> {
  const { data, error } = await admin
    .from("landlords")
    .select(
      "tenant_id, approval_status, landlord_type, auth_user_id, tenants!inner(name, email, created_at, product_line)",
    )
    .eq("approval_status", "pending")
    .eq("tenants.product_line", "real_estate_only")
    .neq("tenant_id", DAVORS_TENANT_ID);

  assert(!error, error?.message ?? "pending landlord query failed");
  return (data as PendingRow[] | null) ?? [];
}

function parseArgs(argv: string[]) {
  const execute = argv.includes("--execute");
  const allowProduction = argv.includes("--allow-production");
  return { execute, allowProduction };
}

async function main() {
  const argv = process.argv.slice(2);
  loadEnvFromArgv(argv);
  const { execute, allowProduction } = parseArgs(argv);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const isStaging = url.includes(STAGING_REF);
  const isProduction = url.includes(PRODUCTION_REF);
  assert(
    isStaging || isProduction,
    "Expected staging or production Supabase URL in env",
  );
  if (isProduction && !allowProduction) {
    throw new Error(
      "Production backfill blocked. Re-run with --allow-production after review.",
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pending = await fetchPendingLandlords(admin);
  const envLabel = isProduction ? "PRODUCTION" : "staging";
  const modeLabel = execute ? "EXECUTE" : "DRY-RUN";

  console.log(
    `\n=== Backfill pending landlords (${envLabel}, ${modeLabel}) ===\n`,
  );
  console.log(`Pending landlords to process: ${pending.length}\n`);

  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const row of pending) {
    const tenant = row.tenants;
    console.log(
      [
        `- ${tenant?.name ?? row.tenant_id}`,
        `tenant_id=${row.tenant_id}`,
        `type=${row.landlord_type ?? "—"}`,
        `email=${tenant?.email ?? "—"}`,
        `auth=${row.auth_user_id ? "linked" : "none"}`,
        `created=${tenant?.created_at ?? "—"}`,
      ].join(" | "),
    );
  }

  if (!execute) {
    console.log(
      "\nDry-run only — re-run with --execute to approve these landlords (no invites sent).",
    );
    return;
  }

  console.log("\nExecuting approve-only backfill...\n");

  let approved = 0;
  let skipped = 0;

  for (const row of pending) {
    const label = row.tenants?.name ?? row.tenant_id;
    try {
      const result = await approveLandlordForTest(admin, row.tenant_id);
      if (!result.transitioned) {
        skipped += 1;
        console.log(`SKIP — ${label}: already approved`);
        continue;
      }
      approved += 1;
      console.log(`OK — ${label}: pending → approved`);
    } catch (error) {
      console.log(
        `FAIL — ${label}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  const remaining = await fetchPendingLandlords(admin);
  console.log(
    `\nDone. approved=${approved} skipped=${skipped} remaining_pending=${remaining.length}`,
  );
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
