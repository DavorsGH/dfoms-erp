/**
 * Apply scripts/233_handbook_screenshots.sql to staging and verify schema.
 *
 * Usage: npx tsx scripts/apply-233-handbook-screenshots-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";

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

async function connectWithCandidates(
  label: string,
  candidates: string[],
): Promise<pg.Client | null> {
  for (const [index, connectionString] of candidates.entries()) {
    const attempt = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await attempt.connect();
      console.log(`Connected via ${label} candidate`, index);
      return attempt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${label} candidate ${index} failed: ${msg}`);
      try {
        await attempt.end();
      } catch {
        // ignore
      }
    }
  }
  return null;
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(
      `Refusing: expected staging project ${STAGING_PROJECT_REF}, got ${supabaseUrl}`,
    );
  }

  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  const client = await connectWithCandidates("staging", candidates);
  if (!client) {
    throw new Error("Could not connect to staging Postgres.");
  }

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/233_handbook_screenshots.sql"),
      "utf8",
    );
    console.log("Applying 233_handbook_screenshots.sql …");
    await client.query(sql);

    const { rows: tableRows } = await client.query(`
      SELECT to_regclass('public.handbook_screenshots') AS tbl
    `);
    console.log("handbook_screenshots table:", tableRows);

    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'handbook_screenshots'
      ORDER BY ordinal_position
    `);
    console.log("handbook_screenshots columns:", columns);

    const { rows: bucketRows } = await client.query(`
      SELECT id, name, public
      FROM storage.buckets
      WHERE id = 'handbook-screenshots'
    `);
    console.log("handbook-screenshots bucket:", bucketRows);

    if (!tableRows[0]?.tbl) {
      throw new Error("handbook_screenshots table missing");
    }
    if (!bucketRows.length) {
      throw new Error("handbook-screenshots bucket missing");
    }

    console.log("PASS: 233 handbook_screenshots applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
