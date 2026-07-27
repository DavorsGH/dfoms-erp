import { guardSectionAccess } from "@/utils/section-guard";
import { requireFeatureAccess } from "@/utils/tier-access";
import { POS_SECTION_ROLES } from "@/utils/rbac-access";

export default async function PosLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(POS_SECTION_ROLES);
  await requireFeatureAccess("pos");
  return <>{children}</>;
}
