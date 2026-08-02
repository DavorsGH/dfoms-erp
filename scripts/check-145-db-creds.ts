import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function load(p: string) {
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

load(resolve(".env.staging.local"));
let host: string | null = null;
try {
  host = new URL(process.env.DATABASE_URL || "").hostname;
} catch {
  host = null;
}
console.log(
  JSON.stringify({
    hasAccessToken: Boolean(process.env.SUPABASE_ACCESS_TOKEN),
    hasDbPassword: Boolean(
      process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
    ),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    databaseUrlHost: host,
  }),
);
