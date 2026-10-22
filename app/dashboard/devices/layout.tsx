import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { canAccessDevicesHub } from "@/utils/rbac-access";

export const metadata: Metadata = {
  title: "Scanners & Devices",
};

export default async function DevicesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = (await getCurrentUserRole()) as AppRole | null;

  if (!canAccessDevicesHub(role)) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
