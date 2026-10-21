import { guardSectionAccess } from "@/utils/section-guard";

export default async function SuperAdminSegmentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await guardSectionAccess(["super_admin"]);
  return children;
}
