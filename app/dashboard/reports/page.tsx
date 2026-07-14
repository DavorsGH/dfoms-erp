import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { getFirstAccessibleReportCategoryId } from "@/utils/rbac-access";
import { getDefaultReportHref } from "./reports-nav-config";

export default async function ReportsPage() {
  const role = (await getCurrentUserRole()) as AppRole | null;
  const categoryId = getFirstAccessibleReportCategoryId(role);
  redirect(getDefaultReportHref(categoryId));
}
