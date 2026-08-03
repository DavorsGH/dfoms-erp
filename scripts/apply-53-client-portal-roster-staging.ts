/**
 * Apply scripts/53_client_portal_roster_fix.sql to staging so client portal
 * Staffing Coverage can see facility projects + roster employees (Actual Staff).
 *
 * Usage: npx tsx scripts/apply-53-client-portal-roster-staging.ts
 *
 * Staging only (wieflwbfdmjtsdnwbfii). Does not touch production.
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
  // Prefer staging env last so it wins over any local/production overrides.
  try {
    loadEnvForce(resolve(process.cwd(), ".env.local"));
  } catch {
    // optional
  }
  try {
    loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  } catch {
    // optional
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    `https://${STAGING_PROJECT_REF}.supabase.co`;

  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(
      `Refusing to apply: NEXT_PUBLIC_SUPABASE_URL is not staging (${STAGING_PROJECT_REF}).`,
    );
  }

  const candidates = buildCandidates(process.env.DATABASE_URL, supabaseUrl);
  const connected = await connectWithCandidates("staging", candidates);

  if (!connected) {
    console.error(
      "Could not connect to staging DB. Apply scripts/53_client_portal_roster_fix.sql in the Supabase SQL Editor on wieflwbfdmjtsdnwbfii.",
    );
    process.exit(1);
  }

  const { client } = connected;
  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/53_client_portal_roster_fix.sql"),
      "utf8",
    );

    console.log("Applying 53_client_portal_roster_fix.sql …");
    await client.query(sql);

    const helpersResult = await client.query(`
      SELECT proname
      FROM pg_proc
      WHERE proname IN (
        'client_can_view_roster_project',
        'client_can_view_roster_employee'
      )
      ORDER BY proname
    `);
    const helpers = helpersResult.rows as Array<{ proname: string }>;

    const policiesResult = await client.query(`
      SELECT
        pol.polname,
        position(
          'client_can_view_roster_project'
          in coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
        ) > 0 AS uses_project_helper,
        position(
          'client_can_view_roster_employee'
          in coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
        ) > 0 AS uses_employee_helper
      FROM pg_policy pol
      WHERE (pol.polrelid = 'projects'::regclass AND pol.polname = 'projects_client_select')
         OR (pol.polrelid = 'employees'::regclass AND pol.polname = 'employees_rbac_select')
      ORDER BY pol.polname
    `);
    const policies = policiesResult.rows as Array<{
      polname: string;
      uses_project_helper: boolean;
      uses_employee_helper: boolean;
    }>;

    console.log(
      "Helpers:",
      helpers.map((r) => r.proname),
    );
    console.log("Policies:", policies);

    const projectOk = policies.some(
      (p) => p.polname === "projects_client_select" && p.uses_project_helper,
    );
    const employeeOk = policies.some(
      (p) => p.polname === "employees_rbac_select" && p.uses_employee_helper,
    );

    if (!projectOk || !employeeOk) {
      throw new Error(
        `Policy verification failed (projectOk=${projectOk}, employeeOk=${employeeOk})`,
      );
    }

    console.log("PASS: script 53 applied on staging");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
