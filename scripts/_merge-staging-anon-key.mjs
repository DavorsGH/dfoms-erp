import { readFileSync, writeFileSync, existsSync } from "node:fs";

function parseEnv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const local = parseEnv(readFileSync(".env.local", "utf8"));
const stagingUrl = local.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

if (!stagingUrl.includes("wieflwbfdmjtsdnwbfii")) {
  console.error(".env.local is not pointing at staging Supabase project");
  process.exit(1);
}

if (!publishable || publishable.startsWith("[") || publishable.length < 20) {
  console.error(".env.local missing a usable NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const targetPath = ".env.staging.local";
let env = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";

function set(key, value) {
  const quoted = JSON.stringify(value);
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) {
    env = env.replace(re, `${key}=${quoted}`);
  } else {
    if (env.length > 0 && !env.endsWith("\n")) env += "\n";
    env += `${key}=${quoted}\n`;
  }
}

set("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishable);
set("NEXT_PUBLIC_SUPABASE_ANON_KEY", publishable);

writeFileSync(targetPath, env);
console.log(
  "Updated .env.staging.local publishable + anon keys from .env.local (staging project)",
);
