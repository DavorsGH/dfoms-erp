import { guardCrmSectionAccess } from "@/utils/section-guard";
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
