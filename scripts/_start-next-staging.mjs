/**
 * Launch `next start -p <port>` with env from .env.staging.local
 * Usage: node scripts/_start-next-staging.mjs 3013
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const port = process.argv[2] || "3013";
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
  "Starting next with staging host",
  env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname
    : "(missing)",
  "port",
  port,
);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "start", "-p", port],
  { env, stdio: "inherit", shell: true },
);

child.on("exit", (code) => process.exit(code ?? 1));
