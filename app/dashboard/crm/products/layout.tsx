import { guardCrmFullFeatureAccess } from "@/utils/section-guard";

export default async function CrmProductsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await guardCrmFullFeatureAccess();
  return children;
}
