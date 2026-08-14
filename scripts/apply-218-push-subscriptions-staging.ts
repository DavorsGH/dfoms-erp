/**
 * Apply scripts/218_push_subscriptions.sql to staging.
 *
 * Usage: npx tsx scripts/apply-218-push-subscriptions-staging.ts
 *
 * If DATABASE_URL password auth fails, run the SQL file in Supabase SQL Editor
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
      console.log(`Connected (${label}) via candidate #${index + 1}`);
      return { client: attempt, index };
    } catch {
      await attempt.end().catch(() => undefined);
    }
  }
  return null;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const stagingRef = "wieflwbfdmjtsdnwbfii";
  if (!supabaseUrl.includes(stagingRef)) {
    throw new Error("Refusing non-staging Supabase URL");
  }

  const sql = readFileSync(
    resolve(process.cwd(), "scripts/218_push_subscriptions.sql"),
    "utf8",
  );

  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  const connected = await connectWithCandidates("staging", candidates);
  if (!connected) {
    console.error(
      "Could not connect to staging Postgres. Apply scripts/218_push_subscriptions.sql manually.",
    );
    process.exit(1);
  }

  const { client } = connected;
  try {
    console.log("Applying 218_push_subscriptions.sql …");
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'push_subscriptions'
      ORDER BY ordinal_position
    `);

    console.log("PASS: push_subscriptions columns:", rows.map((r) => r.column_name).join(", "));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
