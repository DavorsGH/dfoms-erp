import { guardSectionAccess } from "@/utils/section-guard";
import { INVENTORY_SECTION_ROLES } from "@/utils/rbac-access";

export default async function InventoryLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(INVENTORY_SECTION_ROLES);
  return <>{children}</>;
}
