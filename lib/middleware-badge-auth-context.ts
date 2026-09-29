import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  signAuthContext,
  type MiddlewareAuthContext,
  type PortalKind,
} from "@/lib/middleware-auth-context";
import type { MiddlewareAccountRow } from "@/lib/middleware-persona";
import { isNotificationBadgeApiRequest } from "@/lib/notification-badge-api";

export type BadgeAuthContextPayload = Omit<
  MiddlewareAuthContext,
  "issuedAtMs"
>;

function portalFromUserMetadata(user: User): PortalKind | null {
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

function portalFromBadgePath(pathname: string): PortalKind | null {
  if (pathname === "/api/employee-notifications") {
    return "staff";
  }
  if (pathname === "/api/client-portal/notifications") {
    return "staff";
  }
  if (pathname === "/api/portal/notifications") {
    return "lessee";
  }
  if (pathname === "/api/landlord-portal/notifications") {
    return "landlord";
  }
  return null;
}

/**
 * Build signed auth context for notification badge API routes only.
 * Returns null when identity cannot be resolved the same way route handlers would.
 */
export async function buildBadgeAuthContextPayload(options: {
  supabase: SupabaseClient;
  user: User;
  pathname: string;
  searchParams: URLSearchParams;
  accountRow: MiddlewareAccountRow | null;
  onDbCall?: (count?: number) => void;
}): Promise<BadgeAuthContextPayload | null> {
  if (
    !isNotificationBadgeApiRequest(options.pathname, options.searchParams)
  ) {
    return null;
  }

  const portal =
    portalFromUserMetadata(options.user) ??
    portalFromBadgePath(options.pathname);
  if (!portal) {
    return null;
  }

  const base = {
    authUid: options.user.id,
    email: options.user.email ?? null,
    isActive: true,
    portal,
    employeeId: null as string | null,
    clientId: null as string | null,
    activeBusinessUnitId: null as string | null,
    viewAllBusinessUnits: false,
    tenantId: null as string | null,
    lesseeId: null as string | null,
  };

  if (options.pathname === "/api/employee-notifications") {
    if (
      !options.accountRow?.tenant_id ||
      options.accountRow.is_active === false
    ) {
      return null;
    }
    return {
      ...base,
      tenantId: options.accountRow.tenant_id,
      role: options.accountRow.role,
      employeeId: options.accountRow.employee_id,
      clientId: options.accountRow.client_id,
      activeBusinessUnitId: options.accountRow.active_business_unit_id,
      viewAllBusinessUnits: options.accountRow.view_all_business_units === true,
      isActive: options.accountRow.is_active ?? true,
      portal: "staff",
    };
  }

  if (options.pathname === "/api/client-portal/notifications") {
    if (
      !options.accountRow?.tenant_id ||
      options.accountRow.is_active === false ||
      options.accountRow.role !== "client" ||
      !options.accountRow.client_id
    ) {
      return null;
    }
    return {
      ...base,
      tenantId: options.accountRow.tenant_id,
      role: options.accountRow.role,
      clientId: options.accountRow.client_id,
      isActive: true,
      portal: "staff",
    };
  }

  if (options.pathname === "/api/portal/notifications") {
    options.onDbCall?.(1);
    const { data: lessee } = await options.supabase
      .from("lessees")
      .select("tenant_id, lessee_id, status")
      .eq("auth_user_id", options.user.id)
      .neq("status", "former")
      .maybeSingle();

    if (!lessee?.tenant_id || !lessee.lessee_id) {
      return null;
    }

    return {
      ...base,
      tenantId: lessee.tenant_id,
      role: null,
      lesseeId: lessee.lessee_id,
      portal: "lessee",
    };
  }

  if (options.pathname === "/api/landlord-portal/notifications") {
    options.onDbCall?.(1);
    const { data: landlord } = await options.supabase
      .from("landlords")
      .select("tenant_id")
      .eq("auth_user_id", options.user.id)
      .maybeSingle();

    if (!landlord?.tenant_id) {
      return null;
    }

    return {
      ...base,
      tenantId: landlord.tenant_id,
      role: null,
      portal: "landlord",
    };
  }

  return null;
}

export async function signBadgeAuthContext(
  payload: BadgeAuthContextPayload,
): Promise<string | null> {
  return signAuthContext(payload);
}
