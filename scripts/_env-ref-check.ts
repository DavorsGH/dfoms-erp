// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function supabaseRef(url) {
  const m = /^https?:\/\/([^.]+)\.supabase\.co/.exec((url ?? "").trim());
  return m ? m[1] : "(invalid)";
}

for (const f of [".env.local", ".env.local.backup"]) {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  loadEnvForce(resolve(f));
  console.log(`${f} -> ${supabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
}
