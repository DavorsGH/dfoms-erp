/**
 * Apply scripts/153_lease_advance_and_notice.sql to staging and verify columns.
 *
 * Usage: npx tsx scripts/apply-153-lease-advance-and-notice-staging.ts
 *
 * Staging only (wieflwbfdmjtsdnwbfii). If DB password auth fails, print
 * SQL Editor instructions and exit non-zero.
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
): Promise<{ client: pg.Client; index: number } | null> {
  for (const [index, connectionString] of candidates.entries()) {
    const attempt = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await attempt.connect();
      console.log(`Connected via ${label} candidate`, index);
      return { client: attempt, index };
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
  1. Open project wieflwbfdmjtsdnwbfii → SQL Editor
  2. Paste and run the full contents of:
     scripts/153_lease_advance_and_notice.sql
  3. Confirm columns exist on public.leases:
     advance_rent_amount_ghs, termination_notice_months
`);
}

async function main() {
  const envFiles = [".env.staging.local", ".env.local"];
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/153_lease_advance_and_notice.sql"),
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
    if (!supabaseUrl.includes("wieflwbfdmjtsdnwbfii")) {
      console.warn(`Skipping ${envFile}: not staging project`);
      continue;
    }
    const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
    if (candidates.length === 0) {
      console.warn(`Skipping ${envFile}: no DATABASE_URL / DB password`);
      continue;
    }
    const connected = await connectWithCandidates(envFile, candidates);
    if (connected) {
      client = connected.client;
      break;
    }
  }

  if (!client) {
    printSqlEditorInstructions();
    process.exit(1);
  }

  try {
    console.log("Applying 153_lease_advance_and_notice.sql …");
    await client.query(sql);

    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'leases'
        AND column_name IN (
          'advance_rent_amount_ghs',
          'termination_notice_months'
        )
      ORDER BY column_name
    `);

    console.log("Lease advance/notice columns:", columns);

    const required = ["advance_rent_amount_ghs", "termination_notice_months"];
    const found = new Set(
      (columns as Array<{ column_name: string }>).map((c) => c.column_name),
    );
    const missing = required.filter((name) => !found.has(name));
    if (missing.length > 0) {
      throw new Error(`Missing columns after apply: ${missing.join(", ")}`);
    }

    for (const col of columns as Array<{
      column_name: string;
      is_nullable: string;
    }>) {
      if (col.is_nullable !== "NO") {
        throw new Error(`${col.column_name} should be NOT NULL`);
      }
    }

    const { rows: nullCounts } = await client.query(`
      SELECT
        count(*) FILTER (WHERE advance_rent_amount_ghs IS NULL)::int AS null_advance,
        count(*) FILTER (WHERE termination_notice_months IS NULL)::int AS null_notice,
        count(*)::int AS total
      FROM public.leases
    `);
    console.log("Null check:", nullCounts);

    const { rows: sample } = await client.query(`
      SELECT lease_id, rent_amount_ghs, advance_rent_amount_ghs, termination_notice_months
      FROM public.leases
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.log("Sample leases:", sample);

    console.log(
      "PASS: 153 lease advance_rent_amount_ghs + termination_notice_months applied on staging.",
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
