import { guardSectionAccess } from "@/utils/section-guard";
import { HR_PAYROLL_SECTION_ROLES } from "@/utils/rbac-access";

export default async function HrPayrollLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(HR_PAYROLL_SECTION_ROLES);
  return <>{children}</>;
}
