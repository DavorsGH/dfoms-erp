/**
 * Apply scripts/222_landlords_suspended_approval_status.sql to production.
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

function supabaseRef(url: string) {
  const m = /^https?:\/\/([^.]+)\.supabase\.co/.exec((url ?? "").trim());
  return m ? m[1] : "(invalid)";
}

function buildCandidates(rawUrl: string | undefined, supabaseUrl: string) {
  const candidates: string[] = [];
  if (rawUrl) candidates.push(rawUrl);
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  if (password && supabaseUrl) {
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
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function main() {
  loadEnvForce(resolve(".env.local.backup"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = supabaseRef(supabaseUrl);
  console.log(`Target project ref: ${ref}`);
  if (ref !== "tvcurcnmasnocwdxzgvz") {
    throw new Error(
      `Expected production ref tvcurcnmasnocwdxzgvz but got ${ref}. Aborting.`,
    );
  }

  const sql = readFileSync(
    resolve("scripts/222_landlords_suspended_approval_status.sql"),
    "utf8",
  );
  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  let lastError: unknown = null;

  for (const connectionString of candidates) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query(sql);
      const { rows } = await client.query(
        `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE conname = 'landlords_approval_status_check'`,
      );
      console.log("Applied 222_landlords_suspended_approval_status.sql to production");
      console.log(rows[0]?.def ?? "(constraint not found)");
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

  throw lastError ?? new Error("Unable to connect to production database.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
