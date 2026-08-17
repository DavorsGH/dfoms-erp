/**
 * Audit Google + Azure OAuth config on production Supabase (no secrets printed).
 *
 *   npx tsx scripts/audit-oauth-production.ts --env-file .env.local.backup
 */
import { loadEnvFromArgv, assert } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const EXPECTED_CALLBACK = `https://${PRODUCTION_REF}.supabase.co/auth/v1/callback`;

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
  assert(accessToken, "Missing SUPABASE_ACCESS_TOKEN");

  const cfgResp = await fetch(
    `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/config/auth`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  assert(cfgResp.ok, `Supabase auth config fetch failed (${cfgResp.status})`);
  const cfg = (await cfgResp.json()) as {
    external_google_enabled?: boolean;
    external_google_client_id?: string;
    external_google_secret?: string;
    external_azure_enabled?: boolean;
    external_azure_client_id?: string;
    external_azure_secret?: string;
    external_azure_url?: string | null;
  };

  console.log("=== Production Supabase OAuth (tvcurcnmasnocwdxzgvz) ===");
  console.log(`expected_callback: ${EXPECTED_CALLBACK}`);
  console.log("");
  console.log("Google:");
  console.log(`  enabled: ${cfg.external_google_enabled}`);
  console.log(`  client_id: ${cfg.external_google_client_id ?? "(none)"}`);
  console.log(`  secret_set: ${Boolean(cfg.external_google_secret)}`);
  console.log(
    `  secret_api_field_length: ${cfg.external_google_secret?.length ?? 0}`,
  );
  console.log("");
  console.log("Azure:");
  console.log(`  enabled: ${cfg.external_azure_enabled}`);
  console.log(`  client_id: ${cfg.external_azure_client_id ?? "(none)"}`);
  console.log(
    `  tenant_url: ${cfg.external_azure_url?.trim() || "https://login.microsoftonline.com/common"}`,
  );
  console.log(`  secret_set: ${Boolean(cfg.external_azure_secret)}`);
  console.log(
    `  secret_api_field_length: ${cfg.external_azure_secret?.length ?? 0}`,
  );

  if (!cfg.external_google_enabled || !cfg.external_google_client_id) {
    throw new Error("Google OAuth not fully configured on production");
  }
  if (!cfg.external_azure_enabled || !cfg.external_azure_client_id) {
    throw new Error("Azure OAuth not fully configured on production");
  }
  console.log("\nProduction Google + Azure providers are enabled with credentials.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
