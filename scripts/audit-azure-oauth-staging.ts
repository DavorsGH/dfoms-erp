/**
 * Audit Azure OAuth config for staging without printing secrets.
 *
 * Optional live secret check (uses plaintext secret from env, not Supabase API hash):
 *   AZURE_CLIENT_SECRET='...' npx tsx scripts/audit-azure-oauth-staging.ts --env-file .env.staging.local
 */
import { loadEnvFromArgv, assert } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const EXPECTED_CALLBACK = `https://${STAGING_REF}.supabase.co/auth/v1/callback`;

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
  assert(accessToken, "Missing SUPABASE_ACCESS_TOKEN");

  const cfgResp = await fetch(
    `https://api.supabase.com/v1/projects/${STAGING_REF}/config/auth`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  assert(cfgResp.ok, `Supabase auth config fetch failed (${cfgResp.status})`);
  const cfg = (await cfgResp.json()) as {
    external_azure_enabled?: boolean;
    external_azure_client_id?: string;
    external_azure_secret?: string;
    external_azure_url?: string | null;
  };

  const clientId = cfg.external_azure_client_id ?? "";
  const tenantUrl =
    cfg.external_azure_url?.trim() || "https://login.microsoftonline.com/common";

  console.log("=== Supabase Azure config ===");
  console.log(`enabled: ${cfg.external_azure_enabled}`);
  console.log(`client_id: ${clientId}`);
  console.log(`tenant_url: ${tenantUrl}`);
  console.log(`secret_set: ${Boolean(cfg.external_azure_secret)}`);
  console.log(
    `secret_api_field_length: ${cfg.external_azure_secret?.length ?? 0} (SHA-256 hash via Management API)`,
  );
  console.log(`expected_callback: ${EXPECTED_CALLBACK}`);

  const liveSecret = process.env.AZURE_CLIENT_SECRET?.trim() ?? "";
  if (!liveSecret) {
    console.log(
      "\nSet AZURE_CLIENT_SECRET to validate the active Azure secret and redirect URIs.",
    );
    return;
  }

  const tokenResp = await fetch(`${tenantUrl}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: liveSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const tokenBody = (await tokenResp.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  console.log("\n=== Microsoft secret validation (client_credentials) ===");
  console.log(`http_status: ${tokenResp.status}`);
  console.log(`token_ok: ${Boolean(tokenBody.access_token)}`);
  console.log(`error: ${tokenBody.error ?? "(none)"}`);
  if (tokenBody.error_description) {
    console.log(
      `error_description: ${String(tokenBody.error_description).slice(0, 240)}`,
    );
  }

  if (!tokenBody.access_token) {
    console.log(
      "\nRoot cause: AZURE_CLIENT_SECRET is invalid/expired or does not match client_id.",
    );
    process.exit(1);
  }

  const graphResp = await fetch(
    `https://graph.microsoft.com/v1.0/applications?$filter=appId eq '${clientId}'&$select=displayName,web,spa,signInAudience`,
    { headers: { Authorization: `Bearer ${tokenBody.access_token}` } },
  );
  const graphBody = (await graphResp.json()) as {
    value?: Array<{
      displayName?: string;
      signInAudience?: string;
      web?: { redirectUris?: string[] };
      spa?: { redirectUris?: string[] };
    }>;
  };

  console.log("\n=== Azure app registration (Graph) ===");
  console.log(`graph_status: ${graphResp.status}`);
  const app = graphBody.value?.[0];
  if (!app) {
    console.log("app: not found via Graph (may need Application.Read.All)");
    return;
  }

  console.log(`display_name: ${app.displayName ?? "(unknown)"}`);
  console.log(`sign_in_audience: ${app.signInAudience ?? "(unknown)"}`);
  const webUris = app.web?.redirectUris ?? [];
  const spaUris = app.spa?.redirectUris ?? [];
  console.log(`web_redirect_uris: ${JSON.stringify(webUris)}`);
  console.log(`spa_redirect_uris: ${JSON.stringify(spaUris)}`);
  console.log(
    `callback_on_web_platform: ${webUris.includes(EXPECTED_CALLBACK)}`,
  );

  if (spaUris.includes(EXPECTED_CALLBACK) && !webUris.includes(EXPECTED_CALLBACK)) {
    console.log("\nRoot cause: callback URI registered as SPA instead of Web.");
    process.exit(1);
  }
  if (!webUris.includes(EXPECTED_CALLBACK)) {
    console.log("\nRoot cause: callback URI missing from Web redirect URIs.");
    process.exit(1);
  }

  console.log("\nAzure secret and redirect URI look valid.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
