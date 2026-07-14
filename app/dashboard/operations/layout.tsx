import { guardSectionAccess } from "@/utils/section-guard";
import { OPERATIONS_SECTION_ROLES } from "@/utils/rbac-access";

export default async function OperationsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(OPERATIONS_SECTION_ROLES);
  return <>{children}</>;
}
