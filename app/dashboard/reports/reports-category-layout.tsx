import { redirect } from "next/navigation";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import {
  canAccessReportCategory,
} from "@/utils/rbac-access";
import ReportsCategoryNav from "./reports-category-nav";

type ReportsCategoryLayoutProps = {
  categoryId: string;
  pageTitle: string;
  children: React.ReactNode;
};

export default async function ReportsCategoryLayout({
  categoryId,
  pageTitle,
  children,
}: ReportsCategoryLayoutProps) {
  const role = (await getCurrentUserRole()) as AppRole | null;

  if (!canAccessReportCategory(role, categoryId)) {
    redirect("/dashboard");
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">{pageTitle}</h1>
      <ReportsCategoryNav categoryId={categoryId} />
      {children}
    </div>
  );
}
