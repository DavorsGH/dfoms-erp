/**
 * Read-only: why Leave Approvals sidebar shows for some users but not David.
 * Usage:
 *   npx tsx scripts/_probe-leave-approvals-nav-visibility.ts --env-file .env.staging.local
 *   npx tsx scripts/_probe-leave-approvals-nav-visibility.ts --env-file .env.local.backup
 */
import { createClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";
import { loadEnvFromArgv } from "./lib/env";

const TARGET_EMAIL = "david.avors@gmail.com";

type LeaveApproverRow = {
  id: string;
  tenant_id: string;
  approver_user_account_id: string;
  effective_from: string;
  notes: string | null;
  created_at: string;
};

type UserAccountRow = {
  auth_uid: string;
  email: string | null;
  role: string;
  tenant_id: string;
  employee_id: string | null;
  is_active: boolean | null;
};

async function findAuthUserId(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match?.id) return match.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function inspectUser(
  admin: ReturnType<typeof createClient>,
  label: string,
  authUid: string,
) {
  const { data: account, error: accountError } = await admin
    .from("user_accounts")
    .select("auth_uid, email, role, tenant_id, employee_id, is_active")
    .eq("auth_uid", authUid)
    .maybeSingle();
  if (accountError) throw accountError;

  const row = account as UserAccountRow | null;
  if (!row) {
    console.log(`\n--- ${label} ---`);
    console.log("user_accounts: NOT FOUND");
    return null;
  }

  const tenantId = row.tenant_id;

  const { data: approverRows, error: approverError } = await admin
    .from("leave_approver_config")
    .select("id, tenant_id, approver_user_account_id, effective_from, notes, created_at")
    .eq("tenant_id", tenantId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);
  if (approverError) throw approverError;

  const latest = (approverRows as LeaveApproverRow[] | null)?.[0] ?? null;
  const isCurrentApprover = latest?.approver_user_account_id === authUid;

  const { count: pendingCount, error: pendingError } = await admin
    .from("leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("approver_user_account_id", authUid)
    .eq("status", "Pending");
  if (pendingError) throw pendingError;

  const { count: anyAssignedCount, error: anyError } = await admin
    .from("leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("approver_user_account_id", authUid);
  if (anyError) throw anyError;

  const { data: employeeRows, error: employeeError } = await admin
    .from("employees")
    .select("employee_id, full_name, email, tenant_id")
    .eq("tenant_id", tenantId)
    .ilike("email", TARGET_EMAIL);
  if (employeeError) throw employeeError;

  const showLeaveApprovals = isCurrentApprover || (pendingCount ?? 0) > 0;

  console.log(`\n--- ${label} ---`);
  console.log(
    JSON.stringify(
      {
        email: row.email,
        role: row.role,
        employee_id: row.employee_id,
        tenant_id: row.tenant_id,
        auth_uid: row.auth_uid,
        is_active: row.is_active,
        is_current_leave_approver: isCurrentApprover,
        pending_leave_requests_as_approver: pendingCount ?? 0,
        total_leave_requests_as_approver: anyAssignedCount ?? 0,
        would_show_leave_approvals_sidebar: showLeaveApprovals,
        latest_leave_approver_config: latest
          ? {
              approver_user_account_id: latest.approver_user_account_id,
              effective_from: latest.effective_from,
              notes: latest.notes,
              created_at: latest.created_at,
              approver_is_this_user:
                latest.approver_user_account_id === authUid,
            }
          : null,
        recent_leave_approver_config_rows: (approverRows ?? []).map((r) => ({
          approver_user_account_id: (r as LeaveApproverRow).approver_user_account_id,
          effective_from: (r as LeaveApproverRow).effective_from,
          created_at: (r as LeaveApproverRow).created_at,
        })),
        employee_records_matching_david: employeeRows ?? [],
      },
      null,
      2,
    ),
  );

  return { row, showLeaveApprovals, latest, isCurrentApprover };
}

async function listDavorsSuperAdmins(
  admin: ReturnType<typeof createClient>,
) {
  const { data, error } = await admin
    .from("user_accounts")
    .select("auth_uid, email, role, employee_id, is_active")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("role", "super_admin")
    .order("email");
  if (error) throw error;
  return (data ?? []) as UserAccountRow[];
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase env");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`\n=== Leave Approvals nav visibility probe (${envFile}) ===`);
  console.log(`Project: ${new URL(supabaseUrl).hostname.split(".")[0]}`);

  const davidAuthUid = await findAuthUserId(admin, TARGET_EMAIL);
  if (!davidAuthUid) {
    console.log(`Auth user not found for ${TARGET_EMAIL}`);
    return;
  }

  await inspectUser(admin, `David (${TARGET_EMAIL})`, davidAuthUid);

  const productionCurrentApprover = "67e20016-8ad6-4234-b2c2-f3a76811c4aa";
  if (davidAuthUid !== productionCurrentApprover) {
    await inspectUser(
      admin,
      "Production-configured current leave approver (if present)",
      productionCurrentApprover,
    );
  }

  const superAdmins = await listDavorsSuperAdmins(admin);
  console.log("\n--- Davors super_admin accounts ---");
  for (const sa of superAdmins) {
    const email = sa.email ?? sa.auth_uid;
    if (email.toLowerCase() === TARGET_EMAIL.toLowerCase()) continue;
    await inspectUser(admin, `Peer super_admin ${sa.email ?? sa.auth_uid}`, sa.auth_uid);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
