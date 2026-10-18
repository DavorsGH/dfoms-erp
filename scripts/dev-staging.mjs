/**
 * Start `next dev` with .env.staging.local merged into process.env (no --env-file).
 * Staging Supabase guard runs first; does not modify .env.local.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stagingEnvPath = resolve(repoRoot, ".env.staging.local");

function readSupabaseUrlFromFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) continue;
    let value = trimmed.slice("NEXT_PUBLIC_SUPABASE_URL=".length).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

function assertStagingGuard() {
  if (!existsSync(stagingEnvPath)) {
    console.error(`Missing ${stagingEnvPath}`);
    process.exit(1);
  }

  const url =
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() ||
    readSupabaseUrlFromFile(stagingEnvPath);

  if (!url) {
    console.error(`Missing NEXT_PUBLIC_SUPABASE_URL in ${stagingEnvPath}`);
    process.exit(1);
  }

  let projectRef = "";
  try {
    projectRef = new URL(url).hostname.split(".")[0];
  } catch {
    console.error(`Invalid NEXT_PUBLIC_SUPABASE_URL: ${url}`);
    process.exit(1);
  }

  console.log(`Staging guard: Supabase project ref ${projectRef} (${stagingEnvPath})`);

  if (url.includes(PRODUCTION_REF) || projectRef === PRODUCTION_REF) {
    console.error(`Refusing production Supabase project ref ${PRODUCTION_REF}.`);
    process.exit(1);
  }

  if (!url.includes(STAGING_REF)) {
    console.error(
      `Refusing non-staging Supabase URL (expected staging ref ${STAGING_REF}).`,
    );
    process.exit(1);
  }
}

function loadStagingEnv() {
  const result = loadDotenvFile({ path: stagingEnvPath });
  if (result.error) {
    console.error(`Failed to parse ${stagingEnvPath}: ${result.error.message}`);
    process.exit(1);
  }
  return result.parsed ?? {};
}

function resolveNextBin() {
  const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    console.error("Could not find node_modules/next/dist/bin/next — run npm install.");
    process.exit(1);
  }
  return nextBin;
}

assertStagingGuard();

const stagingEnv = loadStagingEnv();
const childEnv = { ...process.env, ...stagingEnv };

const nextBin = resolveNextBin();
const child = spawn(process.execPath, [nextBin, "dev"], {
  cwd: repoRoot,
  env: childEnv,
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
