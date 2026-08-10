import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import {
  CRM_CUSTOMER_LIST_ROLES,
  CRM_SECTION_ROLES,
  isCrmCustomerListPath,
  roleIn,
} from "@/utils/rbac-access";

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

async function getRequestPathname(): Promise<string> {
  const headersList = await headers();
  return headersList.get("x-pathname") ?? "";
}

export async function guardCrmSectionAccess(): Promise<AppRole> {
  const pathname = await getRequestPathname();
  const allowedRoles = isCrmCustomerListPath(pathname)
    ? CRM_CUSTOMER_LIST_ROLES
    : CRM_SECTION_ROLES;

  return guardSectionAccess(allowedRoles);
}
