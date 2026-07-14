import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function getCurrentUserRole(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("role")
    .eq("auth_uid", user.id)
    .maybeSingle();

  return account?.role ?? null;
}

export async function getCurrentUserEmployeeId(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("employee_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  return account?.employee_id ?? null;
}

export async function getCurrentAuthUid(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function getCurrentUserClientId(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("client_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  return account?.client_id ?? null;
}

export async function isCurrentLeaveApprover(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const { data: currentApprover } = await supabase.rpc(
    "current_leave_approver_auth_uid",
  );

  return currentApprover === user.id;
}

export async function hasLeaveApprovalInbox(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  if (await isCurrentLeaveApprover()) {
    return true;
  }

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
