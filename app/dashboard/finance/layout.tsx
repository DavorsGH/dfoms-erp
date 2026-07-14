import { guardSectionAccess } from "@/utils/section-guard";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";

export default async function FinanceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(FINANCE_SECTION_ROLES);
  return <>{children}</>;
}
