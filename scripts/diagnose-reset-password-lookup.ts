/**
 * Diagnose reset-password lookup for Vivian/Charway and tenant auth_uid drift.
 *
 * Usage:
 *   npx tsx scripts/diagnose-reset-password-lookup.ts
 *   npx tsx scripts/diagnose-reset-password-lookup.ts --env-file .env.staging.local
 *
 * Does NOT call updateUserById or change any password.
 */
import Module from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnvForce, loadEnvFromArgv, resolveEnvFile } from "./lib/env";

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };

type AccountRow = {
  auth_uid: string;
  tenant_id: string;
  email: string | null;
  role: string | null;
  employees: { full_name: string | null } | null;
};

function loadEnvFiles() {
  const argv = process.argv.slice(2);
  const primary = resolveEnvFile(argv, ".env.staging.local");
  const cwd = process.cwd();
  const files: string[] = [];

  if (existsSync(resolve(cwd, primary))) {
    files.push(primary);
  }
  if (primary !== ".env.local" && existsSync(resolve(cwd, ".env.local"))) {
    files.push(".env.local");
  }

  if (files.length === 0) {
    return loadEnvFromArgv(argv);
  }

  for (const file of files) {
    loadEnvForce(resolve(cwd, file));
  }
  return files.join(", ");
}

function dedupeAccounts(rows: AccountRow[]): AccountRow[] {
  const seen = new Set<string>();
  const out: AccountRow[] = [];
  for (const row of rows) {
    const key = `${row.auth_uid}:${row.tenant_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function searchMatchingAccounts(admin: SupabaseClient) {
  const select =
    "auth_uid, tenant_id, email, role, employees(full_name)";

  const [byEmail, byVivianName, byCharwayName] = await Promise.all([
    admin.from("user_accounts").select(select).ilike("email", "%vivian%"),
    admin
      .from("user_accounts")
      .select(select)
      .filter("employees.full_name", "ilike", "%Vivian%"),
    admin
      .from("user_accounts")
      .select(select)
      .filter("employees.full_name", "ilike", "%Charway%"),
  ]);

  for (const [label, result] of [
    ["email ilike %vivian%", byEmail] as const,
    ["employees.full_name ilike %Vivian%", byVivianName] as const,
    ["employees.full_name ilike %Charway%", byCharwayName] as const,
  ]) {
    if (result.error) {
      console.error(`Search error (${label}):`, result.error.message);
    }
  }

  return dedupeAccounts([
    ...((byEmail.data ?? []) as unknown as AccountRow[]),
    ...((byVivianName.data ?? []) as unknown as AccountRow[]),
    ...((byCharwayName.data ?? []) as unknown as AccountRow[]),
  ]);
}

async function main() {
  const envFiles = loadEnvFiles();
  const { createAdminClient } = await import("../utils/supabase/admin");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([^.]+)/)?.[1] ?? "(unknown)";
  console.log("=== Reset password lookup diagnostic ===");
  console.log("Env files loaded:", envFiles);
  console.log("Supabase project ref:", ref);
  console.log(
    "SUPABASE_SERVICE_ROLE_KEY present:",
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
  console.log();

  const admin = createAdminClient();

  console.log("--- Step 3: user_accounts search (Vivian / Charway) ---");
  const matches = await searchMatchingAccounts(admin);
  if (matches.length === 0) {
    console.log("No user_accounts rows matched.");
  } else {
    console.log(`Matches (${matches.length}):`);
    for (const row of matches) {
      console.log(
        JSON.stringify(
          {
            auth_uid: row.auth_uid,
            tenant_id: row.tenant_id,
            email: row.email,
            role: row.role,
            employee_full_name: row.employees?.full_name ?? null,
          },
          null,
          2,
        ),
      );
    }
  }
  console.log();

  const first = matches[0];
  if (!first) {
    console.log("Skipping steps 4-6: no match to probe.");
    return;
  }

  const { auth_uid, tenant_id } = first;

  console.log("--- Step 4: auth.admin.getUserById (first match) ---");
  const { data: authUserData, error: authUserError } =
    await admin.auth.admin.getUserById(auth_uid);
  if (authUserError) {
    console.log("getUserById FAILED:", authUserError.message);
    console.log("Auth user exists: false");
  } else if (!authUserData?.user) {
    console.log("getUserById returned no user object.");
    console.log("Auth user exists: false");
  } else {
    console.log("Auth user exists: true");
    console.log(
      JSON.stringify(
        {
          id: authUserData.user.id,
          email: authUserData.user.email,
          created_at: authUserData.user.created_at,
          last_sign_in_at: authUserData.user.last_sign_in_at,
        },
        null,
        2,
      ),
    );
  }
  console.log();

  console.log("--- Step 5: reset-password user_accounts lookup simulation ---");
  console.log(
    `Query: user_accounts where auth_uid=${auth_uid} AND tenant_id=${tenant_id}`,
  );
  const { data: accountLookup, error: accountLookupError } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", auth_uid)
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (accountLookupError) {
    console.log("user_accounts lookup ERROR:", accountLookupError.message);
  } else if (!accountLookup) {
    console.log(
      "user_accounts lookup: NOT FOUND (reset-password would return 404 User account not found)",
    );
  } else {
    console.log("user_accounts lookup: FOUND", accountLookup);
  }
  console.log();

  console.log(
    "--- Step 6: sample 5 user_accounts in same tenant vs getUserById ---",
  );
  console.log("tenant_id:", tenant_id);
  const { data: sampleRows, error: sampleError } = await admin
    .from("user_accounts")
    .select("auth_uid, email, role")
    .eq("tenant_id", tenant_id)
    .limit(5);

  if (sampleError) {
    console.log("Sample fetch error:", sampleError.message);
    return;
  }

  let authExists = 0;
  let authMissing = 0;
  console.log("Per-user results:");
  for (const row of sampleRows ?? []) {
    const { data, error } = await admin.auth.admin.getUserById(row.auth_uid);
    const ok = !error && Boolean(data?.user);
    if (ok) authExists += 1;
    else authMissing += 1;
    console.log(
      JSON.stringify({
        auth_uid: row.auth_uid,
        email: row.email,
        role: row.role,
        auth_user_exists: ok,
        getUserById_error: error?.message ?? null,
      }),
    );
  }
  console.log();
  console.log(
    `Sample summary: ${authExists} auth users OK, ${authMissing} getUserById failed/missing (of ${(sampleRows ?? []).length} rows)`,
  );
  console.log();

  console.log("--- Diagnosis (first match) ---");
  const uaFound = Boolean(accountLookup);
  const authFound = Boolean(authUserData?.user) && !authUserError;
  if (!uaFound) {
    console.log(
      "LIKELY FAILURE AT user_accounts: tenant_id + auth_uid pair not found (404 before auth update).",
    );
  } else if (!authFound) {
    console.log(
      "LIKELY FAILURE AT auth.users: user_accounts row exists but getUserById fails (orphaned auth_uid).",
    );
  } else {
    console.log(
      "Both user_accounts lookup and auth user exist for first match; reset-password should pass lookup (updateUserById not tested).",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
