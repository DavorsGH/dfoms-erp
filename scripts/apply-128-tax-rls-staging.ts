/**
 * Apply scripts/128_tax_ledger_super_admin_tenant_scope_rls.sql to staging.
 * Usage: npx tsx scripts/apply-128-tax-rls-staging.ts
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
    resolve(process.cwd(), "scripts/128_tax_ledger_super_admin_tenant_scope_rls.sql"),
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
      "Could not connect to staging DB. Apply scripts/128_tax_ledger_super_admin_tenant_scope_rls.sql in the Supabase SQL Editor, then re-run the isolation test.",
    );
  }

  try {
    await client.query(sql);
    console.log("Applied script 128 on staging");

    const { rows } = await client.query(`
      SELECT tablename, policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname IN (
          'tax_settings_super_admin_full_access',
          'tax_rate_catalog_super_admin_full_access',
          'tax_ledger_entries_super_admin_full_access'
        )
      ORDER BY tablename
    `);
    for (const row of rows) {
      const usingExpr = String(row.qual ?? "");
      const checkExpr = String(row.with_check ?? "");
      const ok =
        /tenant_matches/i.test(usingExpr) &&
        /is_super_admin/i.test(usingExpr) &&
        /tenant_matches/i.test(checkExpr);
      console.log(
        `${ok ? "OK" : "BAD"} ${row.tablename}.${row.policyname}`,
      );
      console.log(`  USING: ${usingExpr}`);
      console.log(`  CHECK: ${checkExpr}`);
      if (!ok) throw new Error(`Policy still leaky: ${row.policyname}`);
    }

    const { rows: leaky } = await client.query(`
      SELECT tablename, policyname, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('tax_settings', 'tax_rate_catalog', 'tax_ledger_entries')
        AND coalesce(qual, '') ~* 'is_super_admin\\s*\\('
        AND coalesce(qual, '') !~* 'tenant_matches\\s*\\('
    `);
    if (leaky.length) {
      console.error("Still leaky:", leaky);
      throw new Error("Leaky policies remain");
    }
    console.log("PASS live pg_policies: no SA-without-tenant_matches on tax tables");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
