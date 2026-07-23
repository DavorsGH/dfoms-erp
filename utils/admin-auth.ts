import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type AuthResult = { ok: true } | { ok: false; response: NextResponse };

export type SuperAdminResult = AuthResult;

export type TenantSuperAdminResult =
  | { ok: true; tenantId: string }
  | { ok: false; response: NextResponse };

export async function requireRoleIn(roles: readonly string[]): Promise<AuthResult> {
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

  const { data: account } = await supabase
    .from("user_accounts")
    .select("role, is_active")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (
    !account ||
    account.is_active === false ||
    !roles.includes(account.role)
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true };
}

export async function requireSuperAdmin(): Promise<SuperAdminResult> {
  return requireRoleIn(["super_admin"]);
}

export async function requireTenantSuperAdmin(): Promise<TenantSuperAdminResult> {
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

  // Service-role lookup — authoritative tenant_id, not subject to caller RLS.
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

  return { ok: true, tenantId: account.tenant_id };
}

export async function requireTenantRoleIn(
  roles: readonly string[],
): Promise<TenantSuperAdminResult> {
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

  const { data: account } = await supabase
    .from("user_accounts")
    .select("role, is_active, tenant_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (
    !account ||
    account.is_active === false ||
    !roles.includes(account.role) ||
    !account.tenant_id
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, tenantId: account.tenant_id };
}

export async function requireDavorsPlatformSuperAdmin(): Promise<SuperAdminResult> {
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

  const { data: account } = await supabase
    .from("user_accounts")
    .select("role, is_active, tenant_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

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

  return { ok: true };
}

export async function requireAuthenticated(): Promise<
  AuthResult & { userId: string | null }
> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      userId: null,
    };
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("is_active")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (!account || account.is_active === false) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      userId: null,
    };
  }

  return { ok: true, userId: user.id };
}
