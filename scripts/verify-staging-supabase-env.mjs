/**
 * Abort unless NEXT_PUBLIC_SUPABASE_URL points at staging (not production).
 * Used by npm run verify:staging-env (dev:staging uses scripts/dev-staging.mjs).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const envFile = process.argv[2] ? resolve(process.argv[2]) : resolve(".env.staging.local");

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

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() || readSupabaseUrlFromFile(envFile);

if (!url) {
  console.error(`Missing NEXT_PUBLIC_SUPABASE_URL (env or ${envFile}).`);
  process.exit(1);
}

let projectRef = "";
try {
  projectRef = new URL(url).hostname.split(".")[0];
} catch {
  console.error(`Invalid NEXT_PUBLIC_SUPABASE_URL: ${url}`);
  process.exit(1);
}

console.log(`Staging guard: Supabase project ref ${projectRef} (${envFile})`);

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
