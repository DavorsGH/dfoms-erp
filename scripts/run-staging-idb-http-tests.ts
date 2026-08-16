import { execFileSync, spawnSync } from "node:child_process";
import { loadEnvFromArgv } from "./lib/env";

function resolveBypassSecret(): string {
  const existing = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (existing) return existing;

  const raw = execFileSync(
    "npx",
    ["vercel", "project", "protection", "dfoms-erp", "--json"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  const jsonStart = raw.indexOf("{");
  const project = JSON.parse(raw.slice(jsonStart)) as {
    protectionBypass?: Record<string, { isEnvVar?: boolean }>;
  };
  const secrets = Object.keys(project.protectionBypass ?? {});
  if (secrets.length === 0) {
    throw new Error(
      "No automation bypass secret on dfoms-erp. Create one in Vercel Deployment Protection settings.",
    );
  }
  return (
    secrets.find((key) => project.protectionBypass?.[key]?.isEnvVar) ??
    secrets[0]
  );
}

function main() {
  const argv = process.argv.slice(2);
  loadEnvFromArgv(argv);
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = resolveBypassSecret();
  process.env.STAGING_APP_URL =
    process.env.STAGING_APP_URL ??
    "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";

  const envFileIdx = argv.indexOf("--env-file");
  const envFile =
    envFileIdx >= 0 && argv[envFileIdx + 1]
      ? argv[envFileIdx + 1]
      : ".env.staging.local";

  const result = spawnSync(
    "npx",
    ["tsx", "scripts/test-client-idb-cache-security-staging.ts", "--env-file", envFile],
    { stdio: "inherit", env: process.env, shell: process.platform === "win32" },
  );
  process.exit(result.status ?? 1);
}

main();
