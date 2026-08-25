import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortalKind } from "@/lib/middleware-auth-context";

type AdminClient = SupabaseClient;

export type ResolvedPersona =
  | { persona: "staff"; tenantId: string; role: string }
  | { persona: "lessee"; tenantId: string; lesseeId: string }
  | { persona: "landlord"; tenantId: string }
  | {
      persona: "facility_manager";
      tenantId: string;
      facilityManagerId: string;
    };

export async function findStaffPersonaByAuthUid(
  admin: AdminClient,
  authUid: string,
): Promise<Extract<ResolvedPersona, { persona: "staff" }> | null> {
  const { data } = await admin
    .from("user_accounts")
    .select("tenant_id, role, is_active")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (!data || data.is_active === false) {
    return null;
  }

  return {
    persona: "staff",
    tenantId: data.tenant_id,
    role: data.role,
  };
}

export async function findLesseePersonaByAuthUid(
  admin: AdminClient,
  authUid: string,
): Promise<Extract<ResolvedPersona, { persona: "lessee" }> | null> {
  const { data } = await admin
    .from("lessees")
    .select("tenant_id, lessee_id")
    .eq("auth_user_id", authUid)
    .neq("status", "former")
    .maybeSingle();

  if (!data) {
    return null;
  }

  return {
    persona: "lessee",
    tenantId: data.tenant_id,
    lesseeId: data.lessee_id,
  };
}

export async function findLandlordPersonaByAuthUid(
  admin: AdminClient,
  authUid: string,
): Promise<Extract<ResolvedPersona, { persona: "landlord" }> | null> {
  const { data } = await admin
    .from("landlords")
    .select("tenant_id, approval_status")
    .eq("auth_user_id", authUid)
    .maybeSingle();

  if (!data) {
    return null;
  }

  return {
    persona: "landlord",
    tenantId: data.tenant_id,
  };
}

export async function findFacilityManagerPersonaByAuthUid(
  admin: AdminClient,
  authUid: string,
): Promise<Extract<ResolvedPersona, { persona: "facility_manager" }> | null> {
  const { data } = await admin
    .from("facility_managers")
    .select("tenant_id, facility_manager_id")
    .eq("auth_user_id", authUid)
    .eq("status", "active")
    .maybeSingle();

  if (!data) {
    return null;
  }

  return {
    persona: "facility_manager",
    tenantId: data.tenant_id,
    facilityManagerId: data.facility_manager_id,
  };
}

export async function findAnyPersonaByAuthUid(
  admin: AdminClient,
  authUid: string,
): Promise<ResolvedPersona | null> {
  const staff = await findStaffPersonaByAuthUid(admin, authUid);
  if (staff) return staff;

  const lessee = await findLesseePersonaByAuthUid(admin, authUid);
  if (lessee) return lessee;

  const landlord = await findLandlordPersonaByAuthUid(admin, authUid);
  if (landlord) return landlord;

  const facilityManager = await findFacilityManagerPersonaByAuthUid(
    admin,
    authUid,
  );
  if (facilityManager) return facilityManager;

  return null;
}

export async function findPersonaByAuthUid(
  admin: AdminClient,
  authUid: string,
  expected: PortalKind,
): Promise<ResolvedPersona | null> {
  switch (expected) {
    case "staff":
      return findStaffPersonaByAuthUid(admin, authUid);
    case "lessee":
      return findLesseePersonaByAuthUid(admin, authUid);
    case "landlord":
      return findLandlordPersonaByAuthUid(admin, authUid);
    case "facility_manager":
      return findFacilityManagerPersonaByAuthUid(admin, authUid);
  }
}

export async function confirmAuthUserEmailIfNeeded(
  admin: AdminClient,
  authUid: string,
): Promise<void> {
  const { data } = await admin.auth.admin.getUserById(authUid);
  if (!data.user || data.user.email_confirmed_at) {
    return;
  }

  await admin.auth.admin.updateUserById(authUid, {
    email_confirm: true,
  });
}

export function normalizeOAuthEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}
