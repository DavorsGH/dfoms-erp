import type { Metadata } from "next";
import { guardSectionAccess } from "@/utils/section-guard";

export const metadata: Metadata = {
  title: "Inventory",
};
import { requireFeatureAccess } from "@/utils/tier-access";
import { INVENTORY_SECTION_ROLES } from "@/utils/rbac-access";

export default async function InventoryLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(INVENTORY_SECTION_ROLES);
  await requireFeatureAccess("inventory");
  return <>{children}</>;
}
