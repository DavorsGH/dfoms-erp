import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { ACTIVE_STAFF_OTHER_BUSINESS_MESSAGE } from "@/lib/auth/cross-persona-guard";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import { syncSupervisorSites } from "@/utils/admin-user-role";

export { ACTIVE_STAFF_OTHER_BUSINESS_MESSAGE };

export const REUSED_ACCOUNT_LOGIN_HINT =
  "You already have an account. Sign in with your existing password (or use Forgot password if you need a reset).";

type AdminClient = SupabaseClient;

export type StaffAccountRow = {
  auth_uid: string;
  tenant_id: string;
  email: string | null;
  is_active: boolean;
  role: string;
  employee_id: string | null;
  client_id: string | null;
};

/**
 * Resolve auth.users id for an email. Prefers app tables, then Auth listUsers.
 */
export async function findAuthUserIdByEmail(
  admin: AdminClient,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const { data: staff } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .ilike("email", normalized)
    .limit(1)
    .maybeSingle();
  if (staff?.auth_uid) return staff.auth_uid as string;

  const { data: lessee } = await admin
    .from("lessees")
    .select("auth_user_id")
    .ilike("email", normalized)
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (lessee?.auth_user_id) return lessee.auth_user_id as string;

  const { data: landlordTenant } = await admin
    .from("tenants")
    .select("id")
    .ilike("email", normalized)
    .eq("product_line", "real_estate_only")
    .maybeSingle();
  if (landlordTenant?.id) {
    const { data: landlord } = await admin
      .from("landlords")
      .select("auth_user_id")
      .eq("tenant_id", landlordTenant.id)
      .not("auth_user_id", "is", null)
      .maybeSingle();
    if (landlord?.auth_user_id) return landlord.auth_user_id as string;
  }

  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users?.length) break;
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === normalized,
    );
    if (match) return match.id;
    if (data.users.length < 200) break;
  }

  return null;
}

export async function findStaffAccountByEmail(
  admin: AdminClient,
  email: string,
): Promise<StaffAccountRow | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const { data } = await admin
    .from("user_accounts")
    .select(
      "auth_uid, tenant_id, email, is_active, role, employee_id, client_id",
    )
    .ilike("email", normalized)
    .limit(1)
    .maybeSingle();

  return (data as StaffAccountRow | null) ?? null;
}

export async function findStaffAccountByAuthUid(
  admin: AdminClient,
  authUid: string,
): Promise<StaffAccountRow | null> {
  const { data } = await admin
    .from("user_accounts")
    .select(
      "auth_uid, tenant_id, email, is_active, role, employee_id, client_id",
    )
    .eq("auth_uid", authUid)
    .maybeSingle();

  return (data as StaffAccountRow | null) ?? null;
}

/**
 * Clear tenant-scoped staff bindings before moving an identity to a new tenant.
 */
export async function scrubStaffTenantBindings(
  admin: AdminClient,
  authUid: string,
  oldTenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: sitesError } = await admin
    .from("user_account_supervisor_sites")
    .delete()
    .eq("auth_uid", authUid)
    .eq("tenant_id", oldTenantId);

  if (sitesError) {
    return { ok: false, error: sitesError.message };
  }

  const { error: leaveConfigError } = await admin
    .from("leave_approver_config")
    .delete()
    .eq("approver_user_account_id", authUid)
    .eq("tenant_id", oldTenantId);

  if (leaveConfigError) {
    return { ok: false, error: leaveConfigError.message };
  }

  return { ok: true };
}

export type StaffMembershipAssignment = {
  authUid: string;
  tenantId: string;
  role: AppRole;
  email: string;
  employeeId?: string | null;
  clientId?: string | null;
  supervisorSiteCodes?: string[];
};

/**
 * Move or create the single user_accounts row for an auth identity onto a new tenant.
 * Fully resets role/employee/client — nothing from the prior tenant is carried over.
 */
export async function assignStaffMembership(
  admin: AdminClient,
  input: StaffMembershipAssignment,
): Promise<
  | { ok: true; mode: "updated" | "inserted" }
  | { ok: false; error: string }
> {
  const email = input.email.trim().toLowerCase();
  const existing = await findStaffAccountByAuthUid(admin, input.authUid);

  if (existing?.is_active && existing.tenant_id !== input.tenantId) {
    return { ok: false, error: ACTIVE_STAFF_OTHER_BUSINESS_MESSAGE };
  }

  if (existing) {
    if (existing.tenant_id !== input.tenantId) {
      const scrub = await scrubStaffTenantBindings(
        admin,
        input.authUid,
        existing.tenant_id,
      );
      if (!scrub.ok) return scrub;
    }

    const { error: updateError } = await admin
      .from("user_accounts")
      .update({
        tenant_id: input.tenantId,
        role: input.role,
        employee_id: input.employeeId ?? null,
        client_id: input.clientId ?? null,
        email,
        is_active: true,
      })
      .eq("auth_uid", input.authUid);

    if (updateError) {
      return { ok: false, error: updateError.message };
    }

    const siteSyncError = await syncSupervisorSites(
      admin,
      input.authUid,
      input.role,
      input.supervisorSiteCodes ?? [],
      input.tenantId,
    );
    if (siteSyncError) {
      return { ok: false, error: siteSyncError };
    }

    await syncAuthUserPortalMetadata(input.authUid, "staff");
    return { ok: true, mode: "updated" };
  }

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: input.authUid,
    tenant_id: input.tenantId,
    role: input.role,
    employee_id: input.employeeId ?? null,
    client_id: input.clientId ?? null,
    email,
    is_active: true,
  });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  const siteSyncError = await syncSupervisorSites(
    admin,
    input.authUid,
    input.role,
    input.supervisorSiteCodes ?? [],
    input.tenantId,
  );
  if (siteSyncError) {
    await admin.from("user_accounts").delete().eq("auth_uid", input.authUid);
    return { ok: false, error: siteSyncError };
  }

  await syncAuthUserPortalMetadata(input.authUid, "staff");
  return { ok: true, mode: "inserted" };
}

/**
 * Clear portal link so the Auth identity can be reused by another landlord.
 * Does not delete or ban the Auth user.
 */
export async function revokeLesseePortalAccess(
  admin: AdminClient,
  args: { tenantId: string; lesseeId: string },
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const nowIso = new Date().toISOString();

  const { data: lessee, error: lookupError } = await admin
    .from("lessees")
    .select("lessee_id, auth_user_id, status")
    .eq("tenant_id", args.tenantId)
    .eq("lessee_id", args.lesseeId)
    .maybeSingle();

  if (lookupError) {
    return { ok: false, error: lookupError.message, status: 400 };
  }
  if (!lessee) {
    return { ok: false, error: "Lessee not found.", status: 404 };
  }

  const { error: updateError } = await admin
    .from("lessees")
    .update({
      auth_user_id: null,
      status: "former",
      updated_at: nowIso,
    })
    .eq("tenant_id", args.tenantId)
    .eq("lessee_id", args.lesseeId);

  if (updateError) {
    return { ok: false, error: updateError.message, status: 400 };
  }

  return { ok: true };
}
