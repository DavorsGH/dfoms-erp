import { guardCrmFullFeatureAccess } from "@/utils/section-guard";

export default async function CrmDiscountsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await guardCrmFullFeatureAccess();
  return children;
}
