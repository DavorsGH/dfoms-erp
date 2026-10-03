import type { Metadata } from "next";
import { guardSectionAccess } from "@/utils/section-guard";

export const metadata: Metadata = {
  title: "HR",
};
import { HR_PAYROLL_SECTION_ROLES } from "@/utils/rbac-access";

export default async function HrPayrollLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(HR_PAYROLL_SECTION_ROLES);
  return <>{children}</>;
}
