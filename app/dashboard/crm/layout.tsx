import { guardSectionAccess } from "@/utils/section-guard";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";

export default async function CrmLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(CRM_SECTION_ROLES);
  return <>{children}</>;
}
