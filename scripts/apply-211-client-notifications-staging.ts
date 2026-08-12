/**
 * Apply scripts/211_client_notifications.sql to staging.
 *
 * Usage: npx tsx scripts/apply-211-client-notifications-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

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

function buildCandidates(rawUrl, supabaseUrl) {
  const candidates = [];
  if (rawUrl) candidates.push(rawUrl);
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  if (password && supabaseUrl) {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    candidates.push(
      `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
    );
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function main() {
  loadEnvForce(resolve(".env.local"));
  const sql = readFileSync(
    resolve("scripts/211_client_notifications.sql"),
    "utf8",
  );
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  let lastError = null;

  for (const connectionString of candidates) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query(sql);
      const { rows } = await client.query(
        `SELECT to_regclass('public.client_notifications') AS reg`,
      );
      console.log("Applied 211_client_notifications.sql");
      console.log("client_notifications table:", rows[0]?.reg ?? null);
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }

  throw lastError ?? new Error("Unable to connect to staging database.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
