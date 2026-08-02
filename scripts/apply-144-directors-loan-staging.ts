/**
 * Apply scripts/144_manual_entries_directors_loan.sql to staging.
 * Usage: npx tsx scripts/apply-144-directors-loan-staging.ts
 *
 * If DATABASE_URL password auth fails, run the SQL in the Supabase SQL Editor
 * on staging project wieflwbfdmjtsdnwbfii instead.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function rebuildUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

function buildCandidates(rawUrl: string | undefined, supabaseUrl: string) {
  const candidates: string[] = [];
  if (rawUrl) {
    candidates.push(rawUrl, rebuildUrl(rawUrl));
    try {
      const parsed = new URL(rawUrl);
      const password = decodeURIComponent(parsed.password);
      const ref = new URL(supabaseUrl).hostname.split(".")[0];
      for (const region of ["eu-west-1", "eu-north-1"]) {
        candidates.push(
          `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
          `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
        );
      }
      candidates.push(
        `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
      );
    } catch {
      // ignore malformed URL
    }
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Refusing non-staging apply");
  }

  const sql = readFileSync(
    resolve(process.cwd(), "scripts/144_manual_entries_directors_loan.sql"),
    "utf8",
  );

  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  if (candidates.length === 0) {
    throw new Error("No DATABASE_URL for staging");
  }

  let client: pg.Client | null = null;
  let lastError: unknown;
  for (const [index, connectionString] of candidates.entries()) {
    const attempt = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await attempt.connect();
      client = attempt;
      console.log("Connected via candidate", index);
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`candidate ${index} failed: ${msg}`);
      try {
        await attempt.end();
      } catch {
        // ignore
      }
    }
  }

  if (!client) {
    console.error(lastError);
    throw new Error(
      "Could not connect to staging DB. Apply scripts/144_manual_entries_directors_loan.sql in the Supabase SQL Editor on wieflwbfdmjtsdnwbfii, then re-run the staging test.",
    );
  }

  try {
    await client.query(sql);
    console.log("Applied script 144 on staging");
    const { rows } = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'manual_financial_entries'
        AND column_name = 'directors_loan'
    `);
    console.log("Column check:", rows);
    if (!rows.length) throw new Error("directors_loan column still missing");
    console.log("PASS directors_loan column present");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
