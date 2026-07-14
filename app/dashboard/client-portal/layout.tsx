import { guardSectionAccess } from "@/utils/section-guard";
import { CLIENT_PORTAL_SECTION_ROLES } from "@/utils/rbac-access";

export default async function ClientPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(CLIENT_PORTAL_SECTION_ROLES);
  return <>{children}</>;
}
