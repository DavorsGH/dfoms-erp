/**
 * Audit user_accounts rows whose auth_uid has no matching Supabase Auth user.
 *
 *   npx tsx scripts/audit-orphaned-user-accounts-auth.ts --env-file .env.staging.local
 *   npx tsx scripts/audit-orphaned-user-accounts-auth.ts --env-file .env.production.local
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";

type AccountRow = {
  auth_uid: string;
  tenant_id: string;
  email: string | null;
  role: string | null;
  is_active: boolean | null;
  employee_id: string | null;
  client_id: string | null;
  employees: { full_name: string | null } | { full_name: string | null }[] | null;
  clients: { client_name: string | null } | { client_name: string | null }[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function listAllAuthUserIds(admin: SupabaseClient): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`listUsers page ${page}: ${error.message}`);
    }

    for (const user of data.users) {
      if (user.id && user.email) {
        byId.set(user.id, user.email.toLowerCase());
      } else if (user.id) {
        byId.set(user.id, "");
      }
    }

    if (data.users.length < perPage) {
      break;
    }
    page += 1;
  }

  return byId;
}

async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`listUsers page ${page}: ${error.message}`);
    }

    for (const user of data.users) {
      if (user.email?.trim().toLowerCase() === normalized && user.id) {
        return { id: user.id, email: user.email };
      }
    }

    if (data.users.length < perPage) {
      break;
    }
    page += 1;
  }

  return null;
}

export type OrphanAuditRow = {
  auth_uid: string;
  tenant_id: string;
  email: string;
  role: string;
  is_active: boolean;
  display_name: string;
  getUserById_error: string | null;
  auth_user_exists: boolean;
  email_auth_uid: string | null;
  email_mismatch: boolean;
};

export async function auditOrphanedUserAccounts(
  admin: SupabaseClient,
): Promise<OrphanAuditRow[]> {
  const { data: accounts, error } = await admin
    .from("user_accounts")
    .select(
      "auth_uid, tenant_id, email, role, is_active, employee_id, client_id, employees(full_name), clients:customers(client_name)",
    )
    .order("email", { ascending: true });

  if (error) {
    throw new Error(`user_accounts fetch: ${error.message}`);
  }

  const orphans: OrphanAuditRow[] = [];

  for (const row of (accounts ?? []) as AccountRow[]) {
    const email = String(row.email ?? "").trim();
    const employee = firstRelation(row.employees);
    const client = firstRelation(row.clients);
    const displayName =
      employee?.full_name?.trim() ||
      client?.client_name?.trim() ||
      row.employee_id ||
      email ||
      row.auth_uid;

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(
      row.auth_uid,
    );
    const authExists = !authError && Boolean(authData?.user);

    if (authExists) {
      continue;
    }

    let emailAuthUid: string | null = null;
    if (email) {
      const byEmail = await findAuthUserByEmail(admin, email);
      emailAuthUid = byEmail?.id ?? null;
    }

    orphans.push({
      auth_uid: row.auth_uid,
      tenant_id: row.tenant_id,
      email,
      role: String(row.role ?? ""),
      is_active: row.is_active !== false,
      display_name: displayName,
      getUserById_error: authError?.message ?? "no user returned",
      auth_user_exists: false,
      email_auth_uid: emailAuthUid,
      email_mismatch: Boolean(emailAuthUid && emailAuthUid !== row.auth_uid),
    });
  }

  return orphans;
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([^.]+)/)?.[1] ?? "(unknown)";

  console.log("=== Orphaned user_accounts auth audit ===");
  console.log("Env file:", envFile);
  console.log("Supabase project ref:", ref);
  console.log();

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const orphans = await auditOrphanedUserAccounts(admin);

  console.log(`Total orphaned user_accounts: ${orphans.length}`);
  console.log();

  if (orphans.length === 0) {
    console.log("No orphaned accounts found.");
    return;
  }

  const davorsOrphans = orphans.filter((o) => o.tenant_id === DAVORS_TENANT);
  console.log(`Davors tenant (${DAVORS_TENANT}): ${davorsOrphans.length}`);
  console.log();

  for (const row of orphans) {
    console.log(
      JSON.stringify(
        {
          display_name: row.display_name,
          email: row.email,
          auth_uid: row.auth_uid,
          tenant_id: row.tenant_id,
          role: row.role,
          is_active: row.is_active,
          getUserById_error: row.getUserById_error,
          email_auth_uid: row.email_auth_uid,
          email_mismatch: row.email_mismatch,
        },
        null,
        2,
      ),
    );
  }

  console.log();
  console.log(
    "Summary:",
    orphans.map((o) => `${o.display_name} <${o.email}>`).join("; "),
  );
}

if (process.argv[1]?.replace(/\\/g, "/").includes("audit-orphaned-user-accounts-auth")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
