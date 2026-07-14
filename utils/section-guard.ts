import "server-only";

import { redirect } from "next/navigation";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { roleIn } from "@/utils/rbac-access";

export async function guardSectionAccess(
  allowedRoles: readonly AppRole[],
): Promise<AppRole> {
  const role = (await getCurrentUserRole()) as AppRole | null;

  if (!roleIn(role, allowedRoles)) {
    redirect("/dashboard");
  }

  return role!;
}

export async function guardReportCategoryAccess(
  categoryId: string,
  allowedRoles: readonly AppRole[],
): Promise<AppRole> {
  return guardSectionAccess(allowedRoles);
}
