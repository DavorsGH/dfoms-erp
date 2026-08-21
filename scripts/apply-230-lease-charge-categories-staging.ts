/**
 * Apply scripts/230_lease_charge_categories.sql to staging and verify schema.
 *
 * Usage: npx tsx scripts/apply-230-lease-charge-categories-staging.ts
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
     scripts/230_lease_charge_categories.sql
  3. Verify with the SELECT checks in this script.
`);
}

async function main() {
  const envFiles = [".env.staging.local", ".env.local"];
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/230_lease_charge_categories.sql"),
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
    console.log("Applying 230_lease_charge_categories.sql …");
    await client.query(sql);

    const { rows: ledgerColumn } = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'rent_ledger'
        AND column_name = 'charge_category'
    `);
    console.log("rent_ledger.charge_category:", ledgerColumn);

    const { rows: settingsTable } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'lease_charge_settings'
    `);
    console.log("lease_charge_settings table:", settingsTable);

    const { rows: settingsColumns } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'lease_charge_settings'
      ORDER BY ordinal_position
    `);
    console.log("lease_charge_settings columns:", settingsColumns);

    const { rows: settingsCount } = await client.query(`
      SELECT count(*)::int AS total FROM public.lease_charge_settings
    `);
    console.log("lease_charge_settings row count:", settingsCount);

    const { rows: rlsEnabled } = await client.query(`
      SELECT relrowsecurity
      FROM pg_class
      WHERE relname = 'lease_charge_settings'
        AND relnamespace = 'public'::regnamespace
    `);
    console.log("lease_charge_settings RLS:", rlsEnabled);

    if (ledgerColumn.length !== 1) {
      throw new Error("rent_ledger.charge_category column missing");
    }
    if (settingsTable.length !== 1) {
      throw new Error("lease_charge_settings table missing");
    }

    console.log(
      "PASS: 230 lease charge categories applied on staging.",
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
