/**
 * Apply scripts/215_transactional_notification_sms_log.sql to staging.
 *
 * Usage: npx tsx scripts/apply-215-transactional-sms-log-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvForce(filePath: string) {
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

function buildCandidates(rawUrl: string | undefined, supabaseUrl: string) {
  const candidates: string[] = [];
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
  loadEnvForce(resolve(".env.staging.local"));
  const sql = readFileSync(
    resolve("scripts/215_transactional_notification_sms_log.sql"),
    "utf8",
  );
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Refusing non-staging env");
  }
  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  let lastError: unknown = null;

  for (const connectionString of candidates) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query(sql);
      const { rows } = await client.query(
        `SELECT to_regclass('public.transactional_notification_sms_log') AS reg`,
      );
      console.log("Applied 215_transactional_notification_sms_log.sql");
      console.log("transactional_notification_sms_log:", rows[0]?.reg ?? null);
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

  throw lastError ?? new Error("Could not connect to staging database");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
