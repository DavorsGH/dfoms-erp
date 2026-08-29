import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { PortalKind } from "@/lib/middleware-auth-context";

export type MiddlewareAccountRow = {
  is_active: boolean | null;
  tenant_id: string | null;
  role: string | null;
  employee_id: string | null;
  client_id: string | null;
  active_business_unit_id: string | null;
  view_all_business_units?: boolean | null;
};

export type PersonaResolution = {
  isLesseePortalUser: boolean;
  isLandlordPortalUser: boolean;
  isFacilityManagerPortalUser: boolean;
  portal: PortalKind;
  extraDbCalls: number;
};

function portalFromMetadata(user: User): PortalKind | null {
  const meta = user.user_metadata?.portal;
  if (
    meta === "lessee" ||
    meta === "landlord" ||
    meta === "staff" ||
    meta === "facility_manager"
  ) {
    return meta;
  }
  return null;
}

/**
 * Resolve lessee/landlord/facility_manager/staff persona with minimal DB round trips.
 * Skips portal probes on /dashboard/* when a staff user_accounts row exists.
 */
export async function resolveMiddlewarePersona(options: {
  supabase: SupabaseClient;
  user: User;
  pathname: string;
  accountRow: MiddlewareAccountRow | null;
}): Promise<PersonaResolution> {
  const fromMeta = portalFromMetadata(options.user);
  if (fromMeta === "lessee") {
    return {
      isLesseePortalUser: true,
      isLandlordPortalUser: false,
      isFacilityManagerPortalUser: false,
      portal: "lessee",
      extraDbCalls: 0,
    };
  }
  if (fromMeta === "landlord") {
    return {
      isLesseePortalUser: false,
      isLandlordPortalUser: true,
      isFacilityManagerPortalUser: false,
      portal: "landlord",
      extraDbCalls: 0,
    };
  }
  if (fromMeta === "facility_manager") {
    return {
      isLesseePortalUser: false,
      isLandlordPortalUser: false,
      isFacilityManagerPortalUser: true,
      portal: "facility_manager",
      extraDbCalls: 0,
    };
  }
  if (fromMeta === "staff") {
    return {
      isLesseePortalUser: false,
      isLandlordPortalUser: false,
      isFacilityManagerPortalUser: false,
      portal: "staff",
      extraDbCalls: 0,
    };
  }

  if (options.pathname.startsWith("/dashboard") && options.accountRow) {
    return {
      isLesseePortalUser: false,
      isLandlordPortalUser: false,
      isFacilityManagerPortalUser: false,
      portal: "staff",
      extraDbCalls: 0,
    };
  }

  const [{ data: lessee }, { data: landlord }, { data: facilityManager }] =
    await Promise.all([
      options.supabase
        .from("lessees")
        .select("lessee_id")
        .eq("auth_user_id", options.user.id)
        .neq("status", "former")
        .maybeSingle(),
      options.supabase
        .from("landlords")
        .select("tenant_id")
        .eq("auth_user_id", options.user.id)
        .maybeSingle(),
      options.supabase
        .from("facility_managers")
        .select("facility_manager_id")
        .eq("auth_user_id", options.user.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

  const isLesseePortalUser = Boolean(lessee);
  const isLandlordPortalUser = Boolean(landlord);
  const isFacilityManagerPortalUser = Boolean(facilityManager);
  const portal: PortalKind = isLesseePortalUser
    ? "lessee"
    : isLandlordPortalUser
      ? "landlord"
      : isFacilityManagerPortalUser
        ? "facility_manager"
        : "staff";

  return {
    isLesseePortalUser,
    isLandlordPortalUser,
    isFacilityManagerPortalUser,
    portal,
    extraDbCalls: 3,
  };
}
