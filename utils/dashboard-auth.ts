import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import {
  AUTH_CONTEXT_HEADER,
  verifyAuthContext,
  type MiddlewareAuthContext,
} from "@/lib/middleware-auth-context";

type UserAccountRow = {
  role: string | null;
  employee_id: string | null;
  client_id: string | null;
  tenant_id: string | null;
};

type LayoutPerfCounters = {
  authCalls: number;
  dbCalls: number;
  skippedAuthCalls: number;
  skippedDbCalls: number;
};

const layoutPerf: LayoutPerfCounters = {
  authCalls: 0,
  dbCalls: 0,
  skippedAuthCalls: 0,
  skippedDbCalls: 0,
};

export function resetLayoutPerfCounters(): void {
  layoutPerf.authCalls = 0;
  layoutPerf.dbCalls = 0;
  layoutPerf.skippedAuthCalls = 0;
  layoutPerf.skippedDbCalls = 0;
}

export function getLayoutPerfCounters(): LayoutPerfCounters {
  return { ...layoutPerf };
}

const getTrustedAuthContext = cache(
  async (): Promise<MiddlewareAuthContext | null> => {
    const headerStore = await headers();
    return verifyAuthContext(headerStore.get(AUTH_CONTEXT_HEADER));
  },
);

function userFromTrustedContext(ctx: MiddlewareAuthContext): User {
  return {
    id: ctx.authUid,
    email: ctx.email ?? undefined,
    app_metadata: {},
    user_metadata: { portal: ctx.portal },
    aud: "authenticated",
    created_at: "",
  } as User;
}

/** One auth.getUser() per request unless middleware passed a signed context. */
export const getCurrentAuthUser = cache(async (): Promise<User | null> => {
  const trusted = await getTrustedAuthContext();
  if (trusted) {
    layoutPerf.skippedAuthCalls += 1;
    return userFromTrustedContext(trusted);
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  layoutPerf.authCalls += 1;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});

/** One user_accounts row load per request unless middleware passed a signed context. */
export const getCurrentUserAccount = cache(
  async (): Promise<UserAccountRow | null> => {
    const trusted = await getTrustedAuthContext();
    if (trusted) {
      layoutPerf.skippedDbCalls += 1;
      return {
        role: trusted.role,
        employee_id: trusted.employeeId,
        client_id: trusted.clientId,
        tenant_id: trusted.tenantId,
      };
    }

    const user = await getCurrentAuthUser();
    if (!user) {
      return null;
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    layoutPerf.dbCalls += 1;
    const { data: account } = await supabase
      .from("user_accounts")
      .select("role, employee_id, client_id, tenant_id")
      .eq("auth_uid", user.id)
      .maybeSingle();

    return account ?? null;
  },
);

export async function getCurrentUserRole(): Promise<string | null> {
  const account = await getCurrentUserAccount();
  return account?.role ?? null;
}

export async function getCurrentUserEmployeeId(): Promise<string | null> {
  const account = await getCurrentUserAccount();
  return account?.employee_id ?? null;
}

export async function getCurrentAuthUid(): Promise<string | null> {
  const user = await getCurrentAuthUser();
  return user?.id ?? null;
}

export async function getCurrentUserClientId(): Promise<string | null> {
  const account = await getCurrentUserAccount();
  return account?.client_id ?? null;
}

export async function getCurrentUserTenantId(): Promise<string | null> {
  const account = await getCurrentUserAccount();
  return account?.tenant_id ?? null;
}

/** One leave-approver RPC result per request. */
export const getCurrentLeaveApproverAuthUid = cache(
  async (): Promise<string | null> => {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: currentApprover } = await supabase.rpc(
      "current_leave_approver_auth_uid",
    );
    return (currentApprover as string | null) ?? null;
  },
);

export async function isCurrentLeaveApprover(): Promise<boolean> {
  const user = await getCurrentAuthUser();
  if (!user) {
    return false;
  }

  const currentApprover = await getCurrentLeaveApproverAuthUid();
  return currentApprover === user.id;
}

export async function hasLeaveApprovalInbox(): Promise<boolean> {
  const user = await getCurrentAuthUser();
  if (!user) {
    return false;
  }

  if (await isCurrentLeaveApprover()) {
    return true;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { count } = await supabase
    .from("leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("approver_user_account_id", user.id)
    .eq("status", "Pending");

  return (count ?? 0) > 0;
}

export async function isSuperAdmin(): Promise<boolean> {
  const role = await getCurrentUserRole();
  return role === "super_admin";
}

export async function isDavorsPlatformSuperAdmin(): Promise<boolean> {
  const account = await getCurrentUserAccount();
  return (
    account?.role === "super_admin" &&
    account.tenant_id === DAVORS_TENANT_ID
  );
}

/** Real Estate staff on the Davors platform tenant (super_admin or director). */
export async function isDavorsPlatformRealEstateStaff(): Promise<boolean> {
  const account = await getCurrentUserAccount();
  return (
    (account?.role === "super_admin" || account?.role === "director") &&
    account.tenant_id === DAVORS_TENANT_ID
  );
}
