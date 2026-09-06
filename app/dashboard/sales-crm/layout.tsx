import { guardSectionAccess } from "@/utils/section-guard";
import { requireFeatureAccess } from "@/utils/tier-access";
import { CRM_QUOTATIONS_EDIT_ROLES } from "@/utils/rbac-access";

export default async function SalesCrmLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await guardSectionAccess(CRM_QUOTATIONS_EDIT_ROLES);
  await requireFeatureAccess("crm_core");
  return children;
}
