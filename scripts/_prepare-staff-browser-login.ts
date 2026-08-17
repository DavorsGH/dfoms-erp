/**
 * Writes staff magic-link + Vercel bypass to .cursor/browser-login.json (not stdout).
 *   npx tsx scripts/_prepare-staff-browser-login.ts --env-file .env.staging.local
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const stagingAppUrl = (
    process.env.STAGING_APP_URL ??
    "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
  ).replace(/\/$/, "");

  const raw = execFileSync(
    "npx",
    ["vercel", "project", "protection", "dfoms-erp", "--json"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  const project = JSON.parse(raw.slice(raw.indexOf("{"))) as {
    protectionBypass?: Record<string, unknown>;
  };
  const bypass = Object.keys(project.protectionBypass ?? {})[0];
  if (!bypass) {
    throw new Error("No Vercel automation bypass secret configured");
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const staffEmail = process.env.STAGING_STAFF_EMAIL?.trim() ?? "david.avors@gmail.com";
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: staffEmail,
    options: {
      redirectTo: `${stagingAppUrl}/dashboard/real-estate/landlords`,
    },
  });
  if (error) throw error;

  const actionLink = data.properties?.action_link;
  if (!actionLink) {
    throw new Error("No magic link action_link returned");
  }

  const staffUrl = new URL(actionLink);
  staffUrl.searchParams.set("x-vercel-protection-bypass", bypass);

  const outDir = resolve(".cursor");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, "browser-login.json"),
    JSON.stringify(
      {
        stagingAppUrl,
        bypass,
        staffUrl: staffUrl.toString(),
        staffEmail,
      },
      null,
      2,
    ),
  );
  console.log("Wrote .cursor/browser-login.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
