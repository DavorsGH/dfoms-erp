/**
 * Update staging Supabase Azure OAuth secret from AZURE_CLIENT_SECRET env var.
 *
 *   AZURE_CLIENT_SECRET='paste-value-here' npx tsx scripts/update-azure-oauth-staging.ts --env-file .env.staging.local
 */
import { loadEnvFromArgv, assert } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
  const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim() ?? "";
  assert(accessToken, "Missing SUPABASE_ACCESS_TOKEN");
  assert(clientSecret, "Missing AZURE_CLIENT_SECRET (paste Azure secret Value, not Secret ID)");

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(clientSecret)) {
    throw new Error(
      "AZURE_CLIENT_SECRET looks like a Secret ID UUID. Use the secret Value from Azure.",
    );
  }
  if (clientSecret.length < 20) {
    throw new Error("AZURE_CLIENT_SECRET looks too short.");
  }

  const patchResp = await fetch(
    `https://api.supabase.com/v1/projects/${STAGING_REF}/config/auth`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        external_azure_enabled: true,
        external_azure_url: "https://login.microsoftonline.com/common",
        external_azure_secret: clientSecret,
      }),
    },
  );

  if (!patchResp.ok) {
    const body = await patchResp.text();
    throw new Error(`Supabase PATCH failed (${patchResp.status}): ${body.slice(0, 300)}`);
  }

  console.log("Updated Supabase staging Azure OAuth secret and tenant URL (common).");
  console.log("Run: npx tsx scripts/audit-azure-oauth-staging.ts --env-file .env.staging.local");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
