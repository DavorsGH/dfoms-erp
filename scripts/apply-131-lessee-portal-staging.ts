/**
 * Apply scripts/131_lessee_portal_foundation.sql to staging.
 * Usage: npx tsx scripts/apply-131-lessee-portal-staging.ts
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
      candidates.push(
        `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
        `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-north-1.pooler.supabase.com:6543/postgres`,
        `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
      );
    } catch {
      // ignore malformed URL
    }
  }
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  if (password && supabaseUrl) {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    candidates.push(
      `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
      `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
    );
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
    resolve(process.cwd(), "scripts/131_lessee_portal_foundation.sql"),
    "utf8",
  );

  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  if (candidates.length === 0) {
    throw new Error("No DATABASE_URL / DB password for staging");
  }

  let client: pg.Client | null = null;
  let lastError: unknown;
  for (const connectionString of candidates) {
    const attempt = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await attempt.connect();
      client = attempt;
      console.log("Connected via candidate", candidates.indexOf(connectionString));
      break;
    } catch (err) {
      lastError = err;
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
      "Could not connect to staging DB. Apply scripts/131_lessee_portal_foundation.sql in the Supabase SQL Editor.",
    );
  }

  try {
    await client.query(sql);
    console.log("Applied script 131 on staging");

    const { rows: tables } = await client.query(`
      SELECT to_regclass('public.lessee_portal_invites') AS invites
    `);
    console.log("invites table:", tables[0]?.invites);

    const { rows: funcs } = await client.query(`
      SELECT proname FROM pg_proc
      WHERE proname IN ('current_user_lessee_id', 'is_lessee_portal_user')
      ORDER BY 1
    `);
    console.log(
      "helpers:",
      funcs
        .map((r) => String((r as { proname?: unknown }).proname ?? ""))
        .filter(Boolean)
        .join(", "),
    );

    const { rows: policies } = await client.query(`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname LIKE 'lessee_portal_%'
      ORDER BY tablename, policyname
    `);
    for (const row of policies) {
      console.log(`policy ${row.tablename}.${row.policyname}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
