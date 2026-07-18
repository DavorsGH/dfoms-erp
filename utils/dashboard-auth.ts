import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

type UserAccountRow = {
  role: string | null;
  employee_id: string | null;
  client_id: string | null;
  tenant_id: string | null;
};

/** One auth.getUser() per request (layout + page both call helpers). */
export const getCurrentAuthUser = cache(async (): Promise<User | null> => {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});

/** One user_accounts row load per request. */
export const getCurrentUserAccount = cache(
  async (): Promise<UserAccountRow | null> => {
    const user = await getCurrentAuthUser();
    if (!user) {
      return null;
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

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
