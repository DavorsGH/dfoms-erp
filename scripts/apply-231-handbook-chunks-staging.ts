/**
 * Apply scripts/231_handbook_chunks.sql to staging and verify schema.
 *
 * Usage: npx tsx scripts/apply-231-handbook-chunks-staging.ts
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

function printSqlEditorInstructions() {
  console.error(`
Could not connect to staging DB (password / network).

Apply manually in the Supabase SQL Editor:
  1. Open project ${STAGING_PROJECT_REF} → SQL Editor
  2. Paste and run the full contents of:
     scripts/231_handbook_chunks.sql
  3. Re-run: npx tsx scripts/ingest-handbook.ts
`);
}

async function main() {
  const envFiles = [".env.staging.local", ".env.local"];
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/231_handbook_chunks.sql"),
    "utf8",
  );

  let client: pg.Client | null = null;
  for (const envFile of envFiles) {
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_DB_PASSWORD;
    delete process.env.DB_PASSWORD;
    try {
      loadEnvForce(resolve(process.cwd(), envFile));
    } catch {
      console.warn(`Skipping missing ${envFile}`);
      continue;
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
      console.warn(`Skipping ${envFile}: not staging project`);
      continue;
    }
    const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
    if (candidates.length === 0) {
      console.warn(`Skipping ${envFile}: no DATABASE_URL / DB password`);
      continue;
    }
    client = await connectWithCandidates(envFile, candidates);
    if (client) {
      break;
    }
  }

  if (!client) {
    printSqlEditorInstructions();
    process.exit(1);
  }

  try {
    console.log("Applying 231_handbook_chunks.sql …");
    await client.query(sql);

    const { rows: tableRows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'handbook_chunks'
    `);
    console.log("handbook_chunks table:", tableRows);

    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'handbook_chunks'
      ORDER BY ordinal_position
    `);
    console.log("handbook_chunks columns:", columns);

    const { rows: vectorExt } = await client.query(`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `);
    console.log("pgvector extension:", vectorExt);

    const { rows: rlsEnabled } = await client.query(`
      SELECT relrowsecurity
      FROM pg_class
      WHERE relname = 'handbook_chunks'
        AND relnamespace = 'public'::regnamespace
    `);
    console.log("handbook_chunks RLS:", rlsEnabled);

    if (tableRows.length !== 1) {
      throw new Error("handbook_chunks table missing");
    }

    console.log("PASS: 231 handbook_chunks applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
