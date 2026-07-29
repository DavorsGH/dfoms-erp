/**
 * Apply scripts/127_employee_announcements.sql to staging.
 * Usage: npx tsx scripts/apply-127-employee-announcements-staging.ts
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
      // ignore
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
    resolve(process.cwd(), "scripts/127_employee_announcements.sql"),
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
      "Could not connect to staging DB. Apply scripts/127_employee_announcements.sql in the Supabase SQL Editor, then re-run isolation test.",
    );
  }

  try {
    await client.query(sql);
    console.log("Applied script 127 on staging");

    const { rows: tables } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'employee_message_templates',
          'employee_announcements',
          'employee_announcement_recipients',
          'employee_notifications'
        )
      ORDER BY table_name
    `);
    console.log(
      "Tables:",
      tables.map((r) => r.table_name).join(", "),
    );
    if (tables.length !== 4) {
      throw new Error(`Expected 4 tables, found ${tables.length}`);
    }

    const { rows: policies } = await client.query(`
      SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'employee_message_templates',
          'employee_announcements',
          'employee_announcement_recipients',
          'employee_notifications'
        )
      ORDER BY tablename, policyname
    `);
    console.log("\n=== Live policies ===");
    for (const row of policies) {
      const usingExpr = String(row.qual ?? "");
      const checkExpr = String(row.with_check ?? "");
      const saAlone =
        /is_super_admin\s*\(/i.test(usingExpr) &&
        !/tenant_matches\s*\(/i.test(usingExpr);
      const saAloneCheck =
        /is_super_admin\s*\(/i.test(checkExpr) &&
        !/tenant_matches\s*\(/i.test(checkExpr);
      console.log(
        `${saAlone || saAloneCheck ? "LEAKY" : "OK"} ${row.tablename}.${row.policyname} (${row.cmd})`,
      );
      console.log(`  USING: ${usingExpr || "(n/a)"}`);
      console.log(`  CHECK: ${checkExpr || "(n/a)"}`);
      if (saAlone || saAloneCheck) {
        throw new Error(`Leaky SA-without-tenant policy: ${row.policyname}`);
      }
    }

    const notifPolicies = policies.filter(
      (p) => p.tablename === "employee_notifications",
    );
    const names = new Set(notifPolicies.map((p) => p.policyname));
    for (const required of [
      "employee_notifications_select_own",
      "employee_notifications_update_own",
      "employee_notifications_delete_own",
      "employee_notifications_insert_hr",
    ]) {
      if (!names.has(required)) {
        throw new Error(`Missing policy ${required}`);
      }
    }
    if (names.has("employee_notifications_tenant_all")) {
      throw new Error("Legacy tenant_all policy still present on notifications");
    }

    const selectOwn = notifPolicies.find(
      (p) => p.policyname === "employee_notifications_select_own",
    );
    const selectUsing = String(selectOwn?.qual ?? "");
    if (
      !/recipient_user_id\s*=\s*auth\.uid\(\)/i.test(selectUsing) ||
      !/tenant_matches/i.test(selectUsing)
    ) {
      throw new Error("select_own policy missing recipient_user_id = auth.uid()");
    }

    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log("\nPASS policy audit + schema reload notified");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
