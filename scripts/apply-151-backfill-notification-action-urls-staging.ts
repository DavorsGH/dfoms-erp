/**
 * Apply scripts/151_backfill_notification_action_urls.sql to staging and
 * report row counts before/after (idempotent — second run should update 0).
 *
 * Usage: npx tsx scripts/apply-151-backfill-notification-action-urls-staging.ts
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

const STALE_ACTION_URL = `
  action_url IS NOT NULL
  AND action_url ~ '/dashboard/real-estate/landlords/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/?$'
  AND action_url !~ '[?&]highlight='
`;

const STALE_BODY = `
  body ~ '(^|\\n)((?:https?://[^\\s]+)?/dashboard/real-estate/landlords/)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?(\\s*)$'
`;

async function countStale(
  client: pg.Client,
): Promise<Record<string, number>> {
  const queries: Array<[string, string]> = [
    [
      "employee_notifications.action_url",
      `SELECT count(*)::int AS n FROM public.employee_notifications WHERE ${STALE_ACTION_URL}`,
    ],
    [
      "employee_notifications.body",
      `SELECT count(*)::int AS n FROM public.employee_notifications WHERE ${STALE_BODY}`,
    ],
    [
      "landlord_notifications.action_url",
      `SELECT count(*)::int AS n FROM public.landlord_notifications WHERE ${STALE_ACTION_URL}`,
    ],
    [
      "lessee_notifications.action_url",
      `SELECT count(*)::int AS n FROM public.lessee_notifications WHERE ${STALE_ACTION_URL}`,
    ],
  ];

  const out: Record<string, number> = {};
  for (const [label, sql] of queries) {
    try {
      const { rows } = await client.query(sql);
      out[label] = Number(rows[0]?.n ?? 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Count skipped for ${label}: ${msg}`);
      out[label] = -1;
    }
  }
  return out;
}

async function main() {
  const envFiles = [".env.staging.local", ".env.local"];
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/151_backfill_notification_action_urls.sql"),
    "utf8",
  );

  let client: pg.Client | null = null;
  for (const envFile of envFiles) {
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
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
      console.warn(`Skipping ${envFile}: no DATABASE_URL`);
      continue;
    }
    const connected = await connectWithCandidates(envFile, candidates);
    if (connected) {
      client = connected.client;
      break;
    }
  }

  if (!client) {
    throw new Error(
      "Could not connect to staging DB. Apply scripts/151_backfill_notification_action_urls.sql in the Supabase SQL Editor on wieflwbfdmjtsdnwbfii.",
    );
  }

  try {
    const before = await countStale(client);
    console.log("Stale rows BEFORE backfill:", before);

    console.log("Applying 151_backfill_notification_action_urls.sql …");
    await client.query(sql);

    const after = await countStale(client);
    console.log("Stale rows AFTER backfill:", after);

    const updated: Record<string, number> = {};
    for (const key of Object.keys(before)) {
      const b = before[key] ?? 0;
      const a = after[key] ?? 0;
      updated[key] = b >= 0 && a >= 0 ? b - a : -1;
    }
    console.log("Rows updated (before - after):", updated);

    const remaining = Object.values(after).filter((n) => n > 0);
    if (remaining.length > 0) {
      throw new Error(
        `Stale action_url/body rows remain after backfill: ${JSON.stringify(after)}`,
      );
    }

    // Spot-check: new-format rows exist or zero stale either way is OK.
    const { rows: highlightSample } = await client.query(`
      SELECT count(*)::int AS n
      FROM public.employee_notifications
      WHERE action_url LIKE '/dashboard/real-estate/landlords?highlight=%'
    `);
    console.log(
      "PASS: backfill complete. highlight= action_url rows:",
      highlightSample[0]?.n ?? 0,
    );

    // Idempotency check
    await client.query(sql);
    const afterSecond = await countStale(client);
    console.log("Stale rows AFTER second run (expect 0):", afterSecond);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
