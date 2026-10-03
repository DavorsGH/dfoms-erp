import type { Metadata } from "next";
import { guardFinanceSectionAccess } from "@/utils/section-guard";

export const metadata: Metadata = {
  title: "Finance",
};

export default async function FinanceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardFinanceSectionAccess();
  return <>{children}</>;
}
