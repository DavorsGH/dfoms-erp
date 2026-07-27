import { guardSectionAccess } from "@/utils/section-guard";
import { requireFeatureAccess } from "@/utils/tier-access";
import { OPERATIONS_SECTION_ROLES } from "@/utils/rbac-access";

export default async function OperationsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(OPERATIONS_SECTION_ROLES);
  await requireFeatureAccess("operations");
  return <>{children}</>;
}
