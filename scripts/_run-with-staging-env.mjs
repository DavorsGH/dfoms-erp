/**
 * Run a command with .env.staging.local loaded into process.env.
 * Usage: node scripts/_run-with-staging-env.mjs next build
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/_run-with-staging-env.mjs <cmd> [args...]");
  process.exit(1);
}

const envPath = resolve(process.cwd(), ".env.staging.local");
const text = readFileSync(envPath, "utf8");
const env = { ...process.env };

for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const i = trimmed.indexOf("=");
  if (i < 1) continue;
  const key = trimmed.slice(0, i).trim();
  let value = trimmed.slice(i + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

console.log(
  "env host",
  env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname
    : "(missing)",
  "→",
  args.join(" "),
);

const child = spawn(args[0], args.slice(1), {
  env,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
