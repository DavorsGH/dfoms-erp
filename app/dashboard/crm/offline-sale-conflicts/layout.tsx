import { guardCrmFullFeatureAccess } from "@/utils/section-guard";

export default async function CrmOfflineSaleConflictsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await guardCrmFullFeatureAccess();
  return children;
}
