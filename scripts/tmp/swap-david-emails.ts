// @ts-nocheck
/**
 * One-off: swap david.avors@gmail.com ↔ david.avors@davorsfacilities.com between
 * staff super_admin (Davors) and a facility manager (Bernard tenant).
 *
 * Before swap: remove User A's Google identity only (email/password + MFA unchanged).
 * Updates: auth emails, user_accounts, facility_managers, employees (David EMP0001).
 * Does NOT touch: facility_manager_portal_invites, user_activity_log, customers, etc.
 *
 * Default: DRY RUN (read-only). Live writes only with --apply.
 *
 *   npx tsx scripts/tmp/swap-david-emails.ts --env-file .env.local.production-backup-2026-08-25
 *   npx tsx scripts/tmp/swap-david-emails.ts --env-file .env.local.production-backup-2026-08-25 --apply
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";

const STAFF_AUTH_UID = "36bec926-2801-47bf-aa52-d6ab62dcdb8d";
const STAFF_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const STAFF_EMPLOYEE_ID = "EMP0001";
const STAFF_STAFF_ID_EXPECTED = "DF0001";
const STAFF_EMAIL_FROM = "david.avors@gmail.com";
const STAFF_EMAIL_TO = "david.avors@davorsfacilities.com";

const FM_AUTH_UID = "f1c9382a-896d-4b4b-b94d-3c1f3131e3a4";
const FM_ID = "0a4e9b5a-fbcd-48a3-b601-f51654ce2468";
const FM_TENANT_ID = "23b3e0c4-1f4c-4f6c-8e6d-21ae212b6d31";
const FM_EMAIL_FROM = "david.avors@davorsfacilities.com";
const FM_EMAIL_TO = "david.avors@gmail.com";

const SWAP_TEMP_EMAIL = "david.avors+email-swap-temp@davorsfacilities.com";

const TARGET_EMAILS = [STAFF_EMAIL_FROM, STAFF_EMAIL_TO];

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(resolve(filePath), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const envIdx = args.indexOf("--env-file");
  if (envIdx < 0 || !args[envIdx + 1]) {
    throw new Error("Required: --env-file <path>");
  }
  return {
    envFile: args[envIdx + 1],
    apply: args.includes("--apply"),
  };
}

function projectRefFromEnv(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  try {
    return new URL(url).hostname.split(".")[0] ?? url;
  } catch {
    return url;
  }
}

function printJsonBlock(title: string, value: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function fetchGoogleIdentityRow(pgClient: pg.Client) {
  const result = await pgClient.query(
    `SELECT id::text, user_id::text, provider, provider_id, identity_data,
            last_sign_in_at, created_at, updated_at
     FROM auth.identities
     WHERE user_id = $1 AND provider = 'google'`,
    [STAFF_AUTH_UID],
  );
  return result.rows;
}

async function fetchDavidEmployeeRow(pgClient: pg.Client) {
  const result = await pgClient.query(
    `SELECT tenant_id::text, employee_id, staff_id, full_name, email, employment_status
     FROM public.employees
     WHERE tenant_id = $1
       AND lower(email) = lower($2)`,
    [STAFF_TENANT_ID, STAFF_EMAIL_FROM],
  );
  return result.rows[0] ?? null;
}

async function printAuthUser(pgClient: pg.Client, label: string, userId: string) {
  console.log(`\n=== ${label} (auth.users ${userId}) ===`);
  const users = await pgClient.query(
    `SELECT id::text, email, email_confirmed_at, created_at, updated_at
     FROM auth.users WHERE id = $1`,
    [userId],
  );
  console.log(JSON.stringify(users.rows[0] ?? "(not found)", null, 2));

  const identities = await pgClient.query(
    `SELECT id::text, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at
     FROM auth.identities WHERE user_id = $1 ORDER BY provider`,
    [userId],
  );
  console.log(`Identities (${identities.rows.length}):`);
  for (const row of identities.rows) {
    console.log(JSON.stringify(row, null, 2));
  }
}

async function printPublicTargetRows(pgClient: pg.Client) {
  console.log("\n=== user_accounts (staff target) ===");
  const ua = await pgClient.query(
    `SELECT tenant_id::text, auth_uid::text, email, role, is_active, employee_id
     FROM public.user_accounts
     WHERE auth_uid = $1 AND tenant_id = $2`,
    [STAFF_AUTH_UID, STAFF_TENANT_ID],
  );
  console.table(ua.rows);

  console.log("\n=== facility_managers (FM target) ===");
  const fm = await pgClient.query(
    `SELECT facility_manager_id::text, tenant_id::text, auth_user_id::text, email, full_name, status
     FROM public.facility_managers
     WHERE facility_manager_id = $1 AND tenant_id = $2`,
    [FM_ID, FM_TENANT_ID],
  );
  console.table(fm.rows);

  console.log("\n=== employees (David target) ===");
  const emp = await pgClient.query(
    `SELECT tenant_id::text, employee_id, staff_id, full_name, email
     FROM public.employees
     WHERE tenant_id = $1 AND employee_id = $2`,
    [STAFF_TENANT_ID, STAFF_EMPLOYEE_ID],
  );
  console.table(emp.rows);
}

async function scanPublicEmailColumns(pgClient: pg.Client) {
  console.log(
    "\n=== public schema columns containing either swap email (informational; most left unchanged) ===",
  );
  const cols = await pgClient.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('text', 'character varying', 'citext')
     ORDER BY table_name, column_name`,
  );

  let hits = 0;
  for (const col of cols.rows) {
    const sql = `SELECT count(*)::int AS c FROM public.${quoteIdent(col.table_name)} WHERE lower(${quoteIdent(col.column_name)}::text) = ANY($1::text[])`;
    try {
      const result = await pgClient.query(sql, [
        TARGET_EMAILS.map((e) => e.toLowerCase()),
      ]);
      const count = result.rows[0]?.c ?? 0;
      if (count > 0) {
        hits += 1;
        const unchanged =
          col.table_name === "facility_manager_portal_invites" ||
          col.table_name === "user_activity_log" ||
          col.table_name === "customers" ||
          col.table_name === "business_units";
        console.log(
          `  ${col.table_name}.${col.column_name}: ${count} row(s)${unchanged ? " [NOT updated by script]" : ""}`,
        );
      }
    } catch (error) {
      console.log(
        `  ${col.table_name}.${col.column_name}: skip (${error instanceof Error ? error.message : error})`,
      );
    }
  }
  if (hits === 0) {
    console.log("  (no matching rows in scanned columns)");
  }
}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function assertRowCount(label: string, rowCount: number | null, expected = 1) {
  const n = rowCount ?? 0;
  if (n !== expected) {
    throw new Error(`${label}: expected ${expected} row(s) affected, got ${n}`);
  }
}

function printFailureReverses(completed: Array<{ step: string; reverse: string }>) {
  console.error("\n=== FAILURE — completed steps (reverse in order) ===");
  if (completed.length === 0) {
    console.error("(none)");
    return;
  }
  for (let i = completed.length - 1; i >= 0; i -= 1) {
    console.error(`\n--- Reverse: ${completed[i].step} ---`);
    console.error(completed[i].reverse);
  }
}

async function verifyEmailIdentitiesAfterAuth(
  pgClient: pg.Client,
  staffExpected: string,
  fmExpected: string,
) {
  console.log("\n=== Verify email provider identity_data.email (read-only check) ===");
  const rows = await pgClient.query(
    `SELECT user_id::text, provider, identity_data->>'email' AS identity_email
     FROM auth.identities
     WHERE user_id = ANY($1::uuid[]) AND provider = 'email'
     ORDER BY user_id`,
    [[STAFF_AUTH_UID, FM_AUTH_UID]],
  );
  console.table(rows.rows);

  const staffRow = rows.rows.find((r) => r.user_id === STAFF_AUTH_UID);
  const fmRow = rows.rows.find((r) => r.user_id === FM_AUTH_UID);
  const gaps: string[] = [];

  if (!staffRow) {
    gaps.push("User A: no email identity row found");
  } else if (
    String(staffRow.identity_email ?? "").toLowerCase() !==
    staffExpected.toLowerCase()
  ) {
    gaps.push(
      `User A email identity still "${staffRow.identity_email ?? "null"}" — expected "${staffExpected}" (admin API may not sync identity_data; do NOT edit blindly)`,
    );
  }

  if (!fmRow) {
    gaps.push("User B: no email identity row found");
  } else if (
    String(fmRow.identity_email ?? "").toLowerCase() !== fmExpected.toLowerCase()
  ) {
    gaps.push(
      `User B email identity still "${fmRow.identity_email ?? "null"}" — expected "${fmExpected}" (admin API may not sync identity_data; do NOT edit blindly)`,
    );
  }

  if (gaps.length > 0) {
    console.log("\n*** IDENTITY DATA GAPS (informational) ***");
    for (const gap of gaps) {
      console.log(`  - ${gap}`);
    }
  } else {
    console.log("Email identity_data.email matches expected addresses.");
  }
}

async function applySwap(
  admin: ReturnType<typeof createClient>,
  pgClient: pg.Client,
  googleRowBackup: Record<string, unknown>,
) {
  const completed: Array<{ step: string; reverse: string }> = [];

  try {
    console.log("\n=== APPLY step 1: DELETE User A Google identity ===");
    const del = await pgClient.query(
      `DELETE FROM auth.identities
       WHERE user_id = $1 AND provider = 'google'
       RETURNING id::text`,
      [STAFF_AUTH_UID],
    );
    assertRowCount("DELETE auth.identities (google)", del.rowCount, 1);
    completed.push({
      step: "Deleted Google identity",
      reverse: `-- Restore Google identity (review identity_data JSON from dry-run backup):
INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
VALUES (
  '${googleRowBackup.id}',
  '${googleRowBackup.user_id}',
  'google',
  '${googleRowBackup.provider_id}',
  '${JSON.stringify(googleRowBackup.identity_data).replace(/'/g, "''")}'::jsonb,
  ${googleRowBackup.last_sign_in_at ? `'${googleRowBackup.last_sign_in_at}'` : "NULL"},
  '${googleRowBackup.created_at}',
  '${googleRowBackup.updated_at}'
);`,
    });

    console.log("\n=== APPLY step 2–4: auth email swap (email_confirm: true) ===");
    const { error: step1Err } = await admin.auth.admin.updateUserById(
      STAFF_AUTH_UID,
      { email: SWAP_TEMP_EMAIL, email_confirm: true },
    );
    if (step1Err) throw new Error(`Auth step 1 (staff → temp): ${step1Err.message}`);
    completed.push({
      step: "Auth staff → temp email",
      reverse: `admin.auth.admin.updateUserById('${STAFF_AUTH_UID}', { email: '${STAFF_EMAIL_FROM}', email_confirm: true })`,
    });

    const { error: step2Err } = await admin.auth.admin.updateUserById(FM_AUTH_UID, {
      email: FM_EMAIL_TO,
      email_confirm: true,
    });
    if (step2Err) throw new Error(`Auth step 2 (FM → gmail): ${step2Err.message}`);
    completed.push({
      step: "Auth FM → gmail",
      reverse: `admin.auth.admin.updateUserById('${FM_AUTH_UID}', { email: '${FM_EMAIL_FROM}', email_confirm: true })`,
    });

    const { error: step3Err } = await admin.auth.admin.updateUserById(
      STAFF_AUTH_UID,
      { email: STAFF_EMAIL_TO, email_confirm: true },
    );
    if (step3Err) {
      throw new Error(`Auth step 3 (staff → davorsfacilities): ${step3Err.message}`);
    }
    completed.push({
      step: "Auth staff → davorsfacilities",
      reverse: `admin.auth.admin.updateUserById('${STAFF_AUTH_UID}', { email: '${STAFF_EMAIL_FROM}', email_confirm: true })`,
    });

    await verifyEmailIdentitiesAfterAuth(pgClient, STAFF_EMAIL_TO, FM_EMAIL_TO);

    console.log("\n=== APPLY step 5: public.user_accounts ===");
    const ua = await pgClient.query(
      `UPDATE public.user_accounts SET email = $1
       WHERE auth_uid = $2 AND tenant_id = $3::uuid`,
      [STAFF_EMAIL_TO, STAFF_AUTH_UID, STAFF_TENANT_ID],
    );
    assertRowCount("UPDATE user_accounts", ua.rowCount, 1);
    completed.push({
      step: "user_accounts email",
      reverse: `UPDATE public.user_accounts SET email = '${STAFF_EMAIL_FROM}' WHERE auth_uid = '${STAFF_AUTH_UID}' AND tenant_id = '${STAFF_TENANT_ID}';`,
    });

    console.log("\n=== APPLY step 6: public.facility_managers ===");
    const fm = await pgClient.query(
      `UPDATE public.facility_managers SET email = $1
       WHERE facility_manager_id = $2::uuid AND tenant_id = $3::uuid`,
      [FM_EMAIL_TO, FM_ID, FM_TENANT_ID],
    );
    assertRowCount("UPDATE facility_managers", fm.rowCount, 1);
    completed.push({
      step: "facility_managers email",
      reverse: `UPDATE public.facility_managers SET email = '${FM_EMAIL_FROM}' WHERE facility_manager_id = '${FM_ID}' AND tenant_id = '${FM_TENANT_ID}';`,
    });

    console.log("\n=== APPLY step 7: public.employees (David) ===");
    const emp = await pgClient.query(
      `UPDATE public.employees SET email = $1
       WHERE tenant_id = $2::uuid AND employee_id = $3`,
      [STAFF_EMAIL_TO, STAFF_TENANT_ID, STAFF_EMPLOYEE_ID],
    );
    assertRowCount("UPDATE employees", emp.rowCount, 1);
    completed.push({
      step: "employees email",
      reverse: `UPDATE public.employees SET email = '${STAFF_EMAIL_FROM}' WHERE tenant_id = '${STAFF_TENANT_ID}' AND employee_id = '${STAFF_EMPLOYEE_ID}';`,
    });

    console.log("\n=== APPLY succeeded ===");
  } catch (error) {
    printFailureReverses(completed);
    throw error;
  }
}

async function main() {
  const { envFile, apply } = parseArgs();
  loadEnvForce(envFile);

  const projectRef = projectRefFromEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(missing)";
  console.log(`Mode: ${apply ? "APPLY (writes)" : "DRY RUN (read-only)"}`);
  console.log(`Env file: ${envFile}`);
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Project ref: ${projectRef}`);

  if (apply && !supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `Refusing --apply: NEXT_PUBLIC_SUPABASE_URL must contain production ref ${PRODUCTION_PROJECT_REF}.`,
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    throw new Error("DATABASE_URL (or Supabase DB env) is required.");
  }

  const pgClient = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("\nPlanned operations:");
  console.log(
    `  1. DELETE auth.identities WHERE user_id = User A AND provider = 'google' (exactly 1 row)`,
  );
  console.log(
    `  2. Auth swap: Staff ${STAFF_AUTH_UID}: ${STAFF_EMAIL_FROM} → ${STAFF_EMAIL_TO}`,
  );
  console.log(
    `     FM ${FM_AUTH_UID}: ${FM_EMAIL_FROM} → ${FM_EMAIL_TO} (via temp ${SWAP_TEMP_EMAIL})`,
  );
  console.log(`  3. UPDATE user_accounts (tenant ${STAFF_TENANT_ID})`);
  console.log(`  4. UPDATE facility_managers (tenant ${FM_TENANT_ID})`);
  console.log(
    `  5. UPDATE employees ${STAFF_EMPLOYEE_ID} (tenant ${STAFF_TENANT_ID}) → ${STAFF_EMAIL_TO}`,
  );
  console.log(
    "  Leave unchanged: facility_manager_portal_invites, user_activity_log, customers, business_units, …",
  );

  const googleRows = await fetchGoogleIdentityRow(pgClient);
  printJsonBlock(
    "User A — FULL auth.identities row(s) WHERE provider = 'google' (restore from this if needed)",
    googleRows,
  );
  if (googleRows.length !== 1) {
    console.log(
      `\n*** Expected exactly 1 Google identity for User A; found ${googleRows.length}. ***`,
    );
  } else {
    console.log(
      "\nWould run: DELETE FROM auth.identities WHERE user_id = $1 AND provider = 'google' (expect 1 row)",
    );
    console.log(`  params: user_id = ${STAFF_AUTH_UID}`);
  }

  const davidEmployee = await fetchDavidEmployeeRow(pgClient);
  printJsonBlock(
    "employees row matching tenant + david.avors@gmail.com (will update if apply)",
    davidEmployee,
  );
  if (davidEmployee) {
    const okId = davidEmployee.employee_id === STAFF_EMPLOYEE_ID;
    const okStaff = davidEmployee.staff_id === STAFF_STAFF_ID_EXPECTED;
    console.log(
      `  Confirm employee_id ${davidEmployee.employee_id} === ${STAFF_EMPLOYEE_ID}: ${okId ? "YES" : "NO"}`,
    );
    console.log(
      `  Confirm staff_id ${davidEmployee.staff_id} === ${STAFF_STAFF_ID_EXPECTED}: ${okStaff ? "YES" : "NO"}`,
    );
    if (!okId || !okStaff) {
      console.log(
        "*** employee_id/staff_id mismatch — review before --apply ***",
      );
    }
    console.log(
      `\nWould run: UPDATE public.employees SET email = '${STAFF_EMAIL_TO}' WHERE tenant_id = '${STAFF_TENANT_ID}' AND employee_id = '${STAFF_EMPLOYEE_ID}' (expect 1 row)`,
    );
  } else {
    console.log("\n*** No employees row found for tenant + gmail — review before --apply ***");
  }

  await printAuthUser(pgClient, "User A — staff super_admin", STAFF_AUTH_UID);
  await printAuthUser(pgClient, "User B — facility manager", FM_AUTH_UID);
  await printPublicTargetRows(pgClient);
  await scanPublicEmailColumns(pgClient);

  if (!apply) {
    console.log(
      "\nDRY RUN complete. Re-run with --apply to execute (production ref guard enforced).",
    );
    await pgClient.end();
    return;
  }

  if (googleRows.length !== 1) {
    throw new Error("Refusing apply: expected exactly 1 Google identity row on User A.");
  }

  await applySwap(admin, pgClient, googleRows[0]);

  console.log("\n=== AFTER APPLY ===");
  await printAuthUser(pgClient, "User A — after apply", STAFF_AUTH_UID);
  await printAuthUser(pgClient, "User B — after apply", FM_AUTH_UID);
  await printPublicTargetRows(pgClient);
  await pgClient.end();
  console.log("\nAPPLY complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
