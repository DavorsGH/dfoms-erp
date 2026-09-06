import { guardSectionAccess } from "@/utils/section-guard";
import { requireFeatureAccess } from "@/utils/tier-access";
import { CRM_FULL_FEATURE_ROLES } from "@/utils/rbac-access";

export default async function BulkImportLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(CRM_FULL_FEATURE_ROLES);
  await requireFeatureAccess("crm_core");
  return <>{children}</>;
}
