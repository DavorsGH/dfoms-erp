import { guardFinanceSectionAccess } from "@/utils/section-guard";

export default async function FinanceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardFinanceSectionAccess();
  return <>{children}</>;
}
