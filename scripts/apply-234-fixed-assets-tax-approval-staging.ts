/**
 * Apply scripts/234_fixed_assets_tax_approval.sql to staging.
 *
 * Usage: npx tsx scripts/apply-234-fixed-assets-tax-approval-staging.ts
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

function buildCandidates(rawUrl: string | undefined, supabaseUrl: string) {
  const candidates: string[] = [];
  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  if (password && supabaseUrl) {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    for (const region of ["eu-west-1", "eu-north-1"]) {
      candidates.push(
        `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
      );
    }
    candidates.push(
      `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
    );
  }
  if (rawUrl) candidates.push(rawUrl);
  return [...new Set(candidates.filter(Boolean))];
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(`Expected staging project ${STAGING_PROJECT_REF}`);
  }

  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  let client: pg.Client | null = null;
  for (const connectionString of candidates) {
    const attempt = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await attempt.connect();
      client = attempt;
      break;
    } catch {
      await attempt.end().catch(() => undefined);
    }
  }
  if (!client) throw new Error("Could not connect to staging Postgres");

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/234_fixed_assets_tax_approval.sql"),
      "utf8",
    );
    console.log("Applying 234_fixed_assets_tax_approval.sql …");
    await client.query(sql);

    const { rows: cols } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fixed_assets'
        AND column_name IN (
          'approved_by', 'gross_before_wht', 'wht_rate', 'wht_amount',
          'input_vat_amount', 'net_of_tax_amount'
        )
      ORDER BY column_name
    `);
    console.log("fixed_assets tax/approval columns:", cols.map((r) => r.column_name));

    const { rows: sourceIdCol } = await client.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tax_ledger_entries'
        AND column_name = 'source_id'
    `);
    console.log("tax_ledger_entries.source_id type:", sourceIdCol[0]?.data_type);

    const { rows: constraint } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'tax_ledger_entries_source_type_check'
    `);
    console.log("source_type constraint:", constraint[0]?.def ?? "missing");
    if (sourceIdCol[0]?.data_type !== "text") {
      throw new Error("Expected tax_ledger_entries.source_id to be text");
    }
    console.log("PASS: 234 applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
