import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { PortalKind } from "@/lib/middleware-auth-context";

export type MiddlewareAccountRow = {
  is_active: boolean | null;
  tenant_id: string | null;
  role: string | null;
  employee_id: string | null;
  client_id: string | null;
};

export type PersonaResolution = {
  isLesseePortalUser: boolean;
  isLandlordPortalUser: boolean;
  portal: PortalKind;
  extraDbCalls: number;
};

function portalFromMetadata(user: User): PortalKind | null {
  const meta = user.user_metadata?.portal;
  if (meta === "lessee" || meta === "landlord" || meta === "staff") {
    return meta;
  }
  return null;
}

/**
 * Resolve lessee/landlord/staff persona with minimal DB round trips.
 * Skips lessees/landlords probes on /dashboard/* when a staff user_accounts row exists.
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
      portal: "lessee",
      extraDbCalls: 0,
    };
  }
  if (fromMeta === "landlord") {
    return {
      isLesseePortalUser: false,
      isLandlordPortalUser: true,
      portal: "landlord",
      extraDbCalls: 0,
    };
  }
  if (fromMeta === "staff") {
    return {
      isLesseePortalUser: false,
      isLandlordPortalUser: false,
      portal: "staff",
      extraDbCalls: 0,
    };
  }

  if (options.pathname.startsWith("/dashboard") && options.accountRow) {
    return {
      isLesseePortalUser: false,
      isLandlordPortalUser: false,
      portal: "staff",
      extraDbCalls: 0,
    };
  }

  const [{ data: lessee }, { data: landlord }] = await Promise.all([
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
  ]);

  const isLesseePortalUser = Boolean(lessee);
  const isLandlordPortalUser = Boolean(landlord);
  const portal: PortalKind = isLesseePortalUser
    ? "lessee"
    : isLandlordPortalUser
      ? "landlord"
      : options.accountRow
        ? "staff"
        : "staff";

  return {
    isLesseePortalUser,
    isLandlordPortalUser,
    portal,
    extraDbCalls: 2,
  };
}
