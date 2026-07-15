import "server-only";

import { getRoleLabel } from "@/app/dashboard/role-labels";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  getCurrentAuthUser,
  getCurrentUserAccount,
} from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

export type UserDisplayInfo = {
  label: string;
  fullName: string | null;
  photoUrl: string | null;
  email: string;
};

export async function getUserDisplayInfo(): Promise<UserDisplayInfo> {
  const user = await getCurrentAuthUser();
  const email = user?.email ?? "";
  let fullName: string | null = null;
  let photoUrl: string | null = null;
  let label = email;

  if (!user) {
    return { label, fullName, photoUrl, email };
  }

  const account = await getCurrentUserAccount();
  const role = (account?.role as AppRole | undefined) ?? null;
  const roleSuffix = role ? ` [${getRoleLabel(role)}]` : "";

  if (!account) {
    return { label, fullName, photoUrl, email };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (account.employee_id) {
    const { data: employee } = await supabase
      .from("employees")
      .select("full_name, photo_url")
      .eq("employee_id", account.employee_id)
      .maybeSingle();

    if (employee?.full_name?.trim()) {
      fullName = employee.full_name.trim();
      photoUrl = employee.photo_url;
      label = `${fullName}${roleSuffix}`;
    }
  } else if (account.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("client_name")
      .eq("client_id", account.client_id)
      .maybeSingle();

    if (client?.client_name?.trim()) {
      fullName = client.client_name.trim();
      label = `${fullName}${roleSuffix}`;
    }
  }

  return { label, fullName, photoUrl, email };
}
