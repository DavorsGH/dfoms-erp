import type { Metadata } from "next";
import { guardCrmSectionAccess } from "@/utils/section-guard";

export const metadata: Metadata = {
  title: "Sales & CRM",
};
import { requireFeatureAccess } from "@/utils/tier-access";

export default async function CrmLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardCrmSectionAccess();
  await requireFeatureAccess("crm_core");
  return <>{children}</>;
}
