/**
 * Apply scripts/217_client_quotations_ship_to_internal_notes_payment_terms.sql to staging.
 *
 * Usage: npx tsx scripts/apply-217-client-quotations-staging.ts
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
    resolve("scripts/217_client_quotations_ship_to_internal_notes_payment_terms.sql"),
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
      const { rows } = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client_quotations'
          AND column_name IN (
            'ship_to_name',
            'ship_to_address',
            'ship_to_phone',
            'internal_notes',
            'payment_terms'
          )
        ORDER BY column_name
      `);
      console.log("Applied 217_client_quotations_ship_to_internal_notes_payment_terms.sql");
      console.log(
        "columns:",
        rows.map((row: { column_name: string }) => row.column_name).join(", "),
      );
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
