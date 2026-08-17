/**
 * Compare local Azure secret env var (if any) with Supabase-stored secret by hash only.
 */
import { createHash } from "node:crypto";
import { loadEnvFromArgv, assert } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

function sha8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
  assert(accessToken, "Missing SUPABASE_ACCESS_TOKEN");

  const localSecret =
    process.env.AZURE_CLIENT_SECRET?.trim() ||
    process.env.AZURE_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.MICROSOFT_CLIENT_SECRET?.trim() ||
    "";

  const cfgResp = await fetch(
    `https://api.supabase.com/v1/projects/${STAGING_REF}/config/auth`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const cfg = (await cfgResp.json()) as { external_azure_secret?: string };
  const remoteSecret = cfg.external_azure_secret ?? "";

  console.log(
    JSON.stringify(
      {
        local_secret_present: Boolean(localSecret),
        local_secret_length: localSecret.length,
        local_secret_sha8: localSecret ? sha8(localSecret) : null,
        supabase_secret_length: remoteSecret.length,
        supabase_secret_sha8: remoteSecret ? sha8(remoteSecret) : null,
        secrets_match: Boolean(
          localSecret && remoteSecret && localSecret === remoteSecret,
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
