import { guardSectionAccess } from "@/utils/section-guard";
import { CREDIT_NOTES_PAGE_ROLES } from "@/utils/rbac-access";

export default async function CrmCreditNotesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(CREDIT_NOTES_PAGE_ROLES);
  return <>{children}</>;
}
