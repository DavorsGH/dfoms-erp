import { guardSectionAccess } from "@/utils/section-guard";
import { EMPLOYEES_SECTION_ROLES } from "@/utils/rbac-access";

export default async function EmployeesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(EMPLOYEES_SECTION_ROLES);
  return <>{children}</>;
}
