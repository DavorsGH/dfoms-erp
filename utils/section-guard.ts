import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  getCurrentUserEmployeeId,
  getCurrentUserRole,
} from "@/utils/dashboard-auth";
import {
  canAccessFinanceSection,
  canAccessSelfServiceSection,
  CRM_CUSTOMER_LIST_ROLES,
  CRM_FULL_FEATURE_ROLES,
  CRM_SECTION_ROLES,
  FINANCE_SECTION_ROLES,
  FINANCE_SUPPLIERS_PAGE_ROLES,
  isCrmCustomerListPath,
  isFinanceSuppliersPath,
  roleIn,
} from "@/utils/rbac-access";
import { requireFeatureAccess } from "@/utils/tier-access";

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

/** Full CRM admin tabs — blocks sales_rep scoped subset (defense in depth). */
export async function guardCrmFullFeatureAccess(): Promise<AppRole> {
  return guardSectionAccess(CRM_FULL_FEATURE_ROLES);
}

export async function guardDirectorsBoardAccess(): Promise<AppRole> {
  return guardSectionAccess(["director", "super_admin"]);
}

export async function guardFinanceSectionAccess(): Promise<AppRole> {
  const pathname = await getRequestPathname();

  if (!isFinanceSuppliersPath(pathname)) {
    return guardSectionAccess(FINANCE_SECTION_ROLES);
  }

  const role = await guardSectionAccess(FINANCE_SUPPLIERS_PAGE_ROLES);

  if (!canAccessFinanceSection(role)) {
    await requireFeatureAccess("inventory");
  }

  return role;
}

export async function guardSelfServiceAccess(): Promise<void> {
  const [role, employeeId] = await Promise.all([
    getCurrentUserRole(),
    getCurrentUserEmployeeId(),
  ]);

  if (canAccessSelfServiceSection(role as AppRole | null, employeeId)) {
    return;
  }

  const { hasAttendanceApprovalInbox, hasLeaveApprovalInbox } = await import(
    "@/utils/dashboard-auth"
  );
  const [showLeave, showAttendance] = await Promise.all([
    hasLeaveApprovalInbox(),
    hasAttendanceApprovalInbox(),
  ]);
  if (!showLeave && !showAttendance) {
    redirect("/dashboard");
  }

  // Approver without a linked employee: only the Approvals inbox is allowed.
  const pathname = await getRequestPathname();
  if (
    pathname.includes("/dashboard/self-service/approvals") ||
    pathname === ""
  ) {
    if (pathname === "") {
      redirect("/dashboard/self-service/approvals");
    }
    return;
  }

  redirect("/dashboard/self-service/approvals");
}
