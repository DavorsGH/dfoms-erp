import { guardSectionAccess } from "@/utils/section-guard";
import { SELF_SERVICE_SECTION_ROLES } from "@/utils/rbac-access";

export default async function SelfServiceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(SELF_SERVICE_SECTION_ROLES);
  return <>{children}</>;
}
