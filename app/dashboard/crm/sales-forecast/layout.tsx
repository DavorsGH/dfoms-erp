import { guardCrmFullFeatureAccess } from "@/utils/section-guard";

export default async function CrmSalesForecastLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await guardCrmFullFeatureAccess();
  return children;
}
