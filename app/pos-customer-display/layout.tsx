import { guardSectionAccess } from "@/utils/section-guard";
import { requireFeatureAccess } from "@/utils/tier-access";
import { POS_SECTION_ROLES } from "@/utils/rbac-access";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export default async function PosCustomerDisplayRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(POS_SECTION_ROLES);
  await requireFeatureAccess("pos");

  return (
    <div className="h-dvh overflow-hidden bg-slate-950 text-white">{children}</div>
  );
}
