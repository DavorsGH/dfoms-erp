/**
 * Probe Admin/Director SMS recipient resolution on staging (Davors tenant).
 * Usage: npx tsx scripts/probe-admin-director-sms-recipients-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";

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
  }
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
  return [...new Set(candidates.filter(Boolean))];
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
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
      try {
        await attempt.end();
      } catch {
        // ignore
      }
    }
  }
  if (!client) {
    console.error("Could not connect to staging DB");
    process.exit(1);
  }

  try {
    const { rows: accounts } = await client.query(
      `
      SELECT
        ua.auth_uid,
        ua.email,
        ua.role,
        ua.is_active,
        ua.employee_id,
        e.full_name AS employee_name,
        e.phone AS employee_phone
      FROM public.user_accounts ua
      LEFT JOIN public.employees e
        ON e.tenant_id = ua.tenant_id
       AND e.employee_id = ua.employee_id
      WHERE ua.tenant_id = $1
        AND ua.is_active = true
        AND ua.role IN ('super_admin', 'director')
      ORDER BY ua.email
      `,
      [DAVORS_TENANT_ID],
    );

    console.log("Admin/Director accounts on Davors tenant:", accounts);

    const { rows: wallet } = await client.query(
      `SELECT balance FROM public.sms_credit_wallets WHERE tenant_id = $1`,
      [DAVORS_TENANT_ID],
    );
    console.log("SMS wallet:", wallet);

    const { rows: events } = await client.query(
      `
      SELECT event_type, event_name, status, message, metadata, created_at
      FROM public.system_event_log
      WHERE event_name ILIKE '%service%contract%'
         OR event_name ILIKE '%draft%invoice%'
         OR message ILIKE '%draft-service-contract%'
      ORDER BY created_at DESC
      LIMIT 10
      `,
    );
    console.log("Recent system_event_log (service contract / draft):", events);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
