/**
 * Post-deploy staging retests for User Accounts invite flow.
 *
 *   npx tsx scripts/test-staging-invite-retest-post-deploy.ts --env-file .env.staging.local
 */
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CLIENT_ID = "CLI002";
const CONFLICT_EMAIL = "avorsjason@gmail.com";

async function waitForDeploy(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await fetch(`${url}/accept-invite`, { redirect: "manual" });
      if (response.status !== 404) {
        console.log(`Deploy probe OK (attempt ${i + 1}): /accept-invite status ${response.status}`);
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  return false;
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const stagingUrl = (
    process.env.STAGING_APP_URL ??
    "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
  ).replace(/\/$/, "");

  console.log("=== Post-deploy staging retest ===");
  console.log("Staging URL:", stagingUrl);

  const deployReady = await waitForDeploy(stagingUrl, 36);
  console.log("Deploy ready (/accept-invite reachable):", deployReady);
  if (!deployReady) {
    console.warn("WARN: deploy may still be building; continuing API-level tests.");
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { createAndSendStaffPortalInvite } = await import("../utils/staff-portal-invite");

  console.log("\n--- Retest 1: avorsjason@gmail.com cross-persona ---");
  const conflict = await createAndSendStaffPortalInvite(admin, {
    tenantId: DAVORS,
    email: CONFLICT_EMAIL,
    role: "client",
    client_id: CLIENT_ID,
    invitedBy: null,
  });
  if (conflict.ok) {
    throw new Error("Expected cross-persona rejection for avorsjason@gmail.com");
  }
  console.log("Status:", conflict.status ?? 400);
  console.log("Error message:", conflict.error);
  const expectedSnippet = "already linked to a staff ERP account";
  if (!conflict.error.includes(expectedSnippet)) {
    throw new Error(`Unexpected error message: ${conflict.error}`);
  }
  console.log("PASS: cross-persona message is specific.");

  console.log("\n--- Retest 2: fresh invite email E2E ---");
  const stamp = Date.now().toString(36);
  const freshEmail = `staging-retest-invite-${stamp}@test.davors`;
  const send = await createAndSendStaffPortalInvite(admin, {
    tenantId: DAVORS,
    email: freshEmail,
    role: "client",
    client_id: CLIENT_ID,
    invitedBy: null,
  });
  if (!send.ok) {
    throw new Error(`Fresh invite failed: ${send.error}`);
  }
  console.log("Invite sent, invite_id:", send.invite_id);
  console.log("PASS: fresh invite email dispatched via Resend.");

  // Cleanup pending invite + any partial state
  if (send.invite_id) {
    await admin.from("staff_portal_invites").delete().eq("invite_id", send.invite_id);
  }
  console.log("Cleaned up pending invite row.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
