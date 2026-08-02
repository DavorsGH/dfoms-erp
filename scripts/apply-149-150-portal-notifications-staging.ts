/**
 * Apply scripts/149_landlord_notifications.sql and
 * scripts/150_lessee_notifications_action_url.sql to staging.
 *
 * Usage: npx tsx scripts/apply-149-150-portal-notifications-staging.ts
 *
 * If DATABASE_URL password auth fails, run both SQL files in the Supabase
 * SQL Editor on staging project wieflwbfdmjtsdnwbfii instead.
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
      connectionTimeoutMillis: 12_000,
    });
    try {
      await attempt.connect();
      console.log(`${label}: connected via candidate #${index + 1}`);
      return { client: attempt, index };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `${label}: candidate #${index + 1} failed: ${message.slice(0, 160)}`,
      );
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
  try {
    loadEnvForce(resolve(process.cwd(), ".env.local"));
  } catch {
    // optional
  }
  try {
    loadEnvForce(resolve(process.cwd(), ".env"));
  } catch {
    // optional
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "https://wieflwbfdmjtsdnwbfii.supabase.co";
  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  const connected = await connectWithCandidates("staging", candidates);

  if (!connected) {
    console.error(
      "Could not connect to staging DB. Apply these in the Supabase SQL Editor on wieflwbfdmjtsdnwbfii:\n" +
        "  - scripts/149_landlord_notifications.sql\n" +
        "  - scripts/150_lessee_notifications_action_url.sql",
    );
    process.exit(1);
  }

  const { client } = connected;
  try {
    const sql149 = readFileSync(
      resolve(process.cwd(), "scripts/149_landlord_notifications.sql"),
      "utf8",
    );
    const sql150 = readFileSync(
      resolve(
        process.cwd(),
        "scripts/150_lessee_notifications_action_url.sql",
      ),
      "utf8",
    );

    console.log("Applying 149_landlord_notifications.sql …");
    await client.query(sql149);
    console.log("Applying 150_lessee_notifications_action_url.sql …");
    await client.query(sql150);

    const { rows: tableRows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'landlord_notifications'
    `);
    const { rows: colRows } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'lessee_notifications'
        AND column_name = 'action_url'
    `);
    const { rows: policies } = await client.query(`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('landlord_notifications', 'lessee_notifications')
      ORDER BY tablename, policyname
    `);

    if (tableRows.length === 0) {
      throw new Error("landlord_notifications table missing after apply");
    }
    if (colRows.length === 0) {
      throw new Error("lessee_notifications.action_url missing after apply");
    }

    console.log("PASS: landlord_notifications present", tableRows[0]);
    console.log("PASS: lessee_notifications.action_url present", colRows[0]);
    console.log(
      "Policies:",
      (
        policies as Array<{ tablename: string; policyname: string }>
      )
        .map((p) => `${p.tablename}.${p.policyname}`)
        .join(", "),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
