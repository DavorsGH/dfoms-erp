import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import type { PortalLoginActorPersona } from "./types";

export type DavorsAdminGate =
  | { ok: true; actorAuthUid: string; actorTenantId: string }
  | { ok: false; response: NextResponse };

export type LandlordGate =
  | {
      ok: true;
      actorAuthUid: string;
      actorTenantId: string;
      landlordType: "platform_only";
    }
  | { ok: false; response: NextResponse };

export type TenantAdminGate =
  | { ok: true; actorAuthUid: string; actorTenantId: string }
  | { ok: false; response: NextResponse };

/**
 * Davors platform super_admin only. Service-role read of user_accounts —
 * never rely on requireTenantSuperAdmin alone.
 */
export async function requireDavorsPlatformSuperAdminServiceRole(): Promise<DavorsAdminGate> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("user_accounts")
    .select("role, is_active, tenant_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }

  if (
    !account ||
    account.is_active === false ||
    account.role !== "super_admin" ||
    account.tenant_id !== DAVORS_TENANT_ID
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    actorAuthUid: user.id,
    actorTenantId: account.tenant_id,
  };
}

/**
 * Platform-only landlord: Auth user must be landlords.auth_user_id for their tenant.
 */
export async function requirePlatformOnlyLandlordPortal(): Promise<LandlordGate> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  const { data: landlord, error } = await admin
    .from("landlords")
    .select("tenant_id, landlord_type, auth_user_id, approval_status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }

  if (
    !landlord ||
    landlord.landlord_type !== "platform_only" ||
    landlord.approval_status !== "approved" ||
    !landlord.tenant_id
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    actorAuthUid: user.id,
    actorTenantId: landlord.tenant_id as string,
    landlordType: "platform_only",
  };
}

/**
 * Any-tenant super_admin (service-role user_accounts read).
 * Used for Administration > User Accounts login access.
 */
export async function requireTenantSuperAdminServiceRole(): Promise<TenantAdminGate> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("user_accounts")
    .select("role, is_active, tenant_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }

  if (
    !account ||
    account.is_active === false ||
    account.role !== "super_admin" ||
    !account.tenant_id
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    actorAuthUid: user.id,
    actorTenantId: account.tenant_id as string,
  };
}

export function actorPersonaFromPath(
  path: "admin" | "landlord" | "tenant_admin",
): PortalLoginActorPersona {
  if (path === "admin") return "davors_admin";
  if (path === "tenant_admin") return "tenant_admin";
  return "landlord";
}
