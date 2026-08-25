import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAuthUserBanned } from "@/utils/lessee-portal-account-management";

export type FacilityManagerPortalSession = {
  authUserId: string;
  email: string | null;
  tenantId: string;
  facilityManagerId: string;
  fullName: string;
  canManageMaintenance: boolean;
  canManageComplaints: boolean;
  canManageInspections: boolean;
  canLogServices: boolean;
  canCollectRent: boolean;
  canCollectCharges: boolean;
  assignedPropertyIds: string[];
};

/**
 * Resolves the signed-in Supabase user to an active facility_managers row.
 */
export const getFacilityManagerSession = cache(
  async (): Promise<FacilityManagerPortalSession | null> => {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const admin = createAdminClient();
    const { data: fm, error } = await admin
      .from("facility_managers")
      .select(
        "facility_manager_id, tenant_id, full_name, email, auth_user_id, status, can_manage_maintenance, can_manage_complaints, can_manage_inspections, can_log_services, can_collect_rent, can_collect_charges",
      )
      .eq("auth_user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (error || !fm) {
      return null;
    }

    const { data: authUserData } = await admin.auth.admin.getUserById(user.id);
    const bannedUntil =
      (authUserData?.user as { banned_until?: string | null } | undefined)
        ?.banned_until ?? null;
    if (isAuthUserBanned(bannedUntil)) {
      return null;
    }

    const { data: assignments } = await admin
      .from("facility_manager_property_assignments")
      .select("property_id")
      .eq("tenant_id", fm.tenant_id)
      .eq("facility_manager_id", fm.facility_manager_id);

    return {
      authUserId: user.id,
      email: user.email ?? fm.email ?? null,
      tenantId: fm.tenant_id,
      facilityManagerId: fm.facility_manager_id,
      fullName:
        typeof fm.full_name === "string" && fm.full_name.trim()
          ? fm.full_name.trim()
          : "Facility Manager",
      canManageMaintenance: Boolean(fm.can_manage_maintenance),
      canManageComplaints: Boolean(fm.can_manage_complaints),
      canManageInspections: Boolean(fm.can_manage_inspections),
      canLogServices: Boolean(fm.can_log_services),
      canCollectRent: Boolean(fm.can_collect_rent),
      canCollectCharges: Boolean(fm.can_collect_charges),
      assignedPropertyIds: (assignments ?? []).map(
        (row) => row.property_id as string,
      ),
    };
  },
);

export async function requireFacilityManagerSession(): Promise<
  | {
      ok: true;
      session: FacilityManagerPortalSession;
      admin: ReturnType<typeof createAdminClient>;
    }
  | { ok: false; response: NextResponse }
> {
  const session = await getFacilityManagerSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, session, admin: createAdminClient() };
}
