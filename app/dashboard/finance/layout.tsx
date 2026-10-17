import type { Metadata } from "next";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { guardFinanceSectionAccess } from "@/utils/section-guard";
import { FinanceRoleProvider } from "./finance-role-context";

export const metadata: Metadata = {
  title: "Finance",
};

export default async function FinanceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await guardFinanceSectionAccess();
  return (
    <FinanceRoleProvider role={role as AppRole}>{children}</FinanceRoleProvider>
  );
}
