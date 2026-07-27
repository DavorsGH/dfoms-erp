import { requireFeatureAccess } from "@/utils/tier-access";

export default async function EmailPromotionsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireFeatureAccess("email_promotions");
  return <>{children}</>;
}
