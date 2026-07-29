/**
 * Apply scripts/129_skipped_no_credit_status.sql to staging.
 * Prefers constructed db.<ref>.supabase.co URL from SUPABASE_DB_PASSWORD
 * when DATABASE_URL auth fails / is stale.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

loadEnvFile(resolve(process.cwd(), ".env.staging.local"));

const pub = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!pub.includes("wieflwbfdmjtsdnwbfii")) {
  throw new Error("Refusing non-staging apply");
}

const projectRef = new URL(pub).hostname.split(".")[0];
const password =
  process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;

const candidates = [];
if (password) {
  candidates.push(
    `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`,
  );
}
const resolved = resolveDatabaseUrl();
if (resolved) candidates.push(resolved);

if (candidates.length === 0) {
  throw new Error("No DATABASE_URL / SUPABASE_DB_PASSWORD available");
}

const { default: pg } = await import("pg");
const sql = readFileSync(
  resolve(process.cwd(), "scripts/129_skipped_no_credit_status.sql"),
  "utf8",
);

let lastError = null;
for (const databaseUrl of candidates) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log("Connected — applying 129_skipped_no_credit_status.sql...");
    await client.query(sql);
    const check = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'employee_announcement_recipients'
        AND c.conname = 'employee_announcement_recipients_status_check'
    `);
    console.log("Announcement status check:", check.rows[0]?.def ?? "missing");
    await client.end();
    console.log("Done.");
    process.exit(0);
  } catch (err) {
    lastError = err;
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    console.warn(
      `Connection candidate failed: ${err instanceof Error ? err.message : err}`,
    );
  }
}

throw lastError ?? new Error("All DB connection candidates failed");
