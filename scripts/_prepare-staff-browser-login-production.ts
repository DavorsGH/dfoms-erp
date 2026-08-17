/**
 * Writes staff magic-link to .cursor/browser-login-production.json for production smoke tests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const PRODUCTION_APP_URL = "https://portal.davorsfacilities.com";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const staffEmail = process.env.PRODUCTION_STAFF_EMAIL?.trim() ?? "david.avors@gmail.com";
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: staffEmail,
    options: { redirectTo: `${PRODUCTION_APP_URL}/dashboard/my-account` },
  });
  if (error) throw error;
  const actionLink = data.properties?.action_link;
  if (!actionLink) throw new Error("No magic link returned");

  const outDir = resolve(".cursor");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, "browser-login-production.json"),
    JSON.stringify(
      { productionAppUrl: PRODUCTION_APP_URL, staffUrl: actionLink, staffEmail },
      null,
      2,
    ),
  );
  console.log("Wrote .cursor/browser-login-production.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
