import { redirect } from "next/navigation";
import {
  getCurrentUserRole,
  isDavorsPlatformSuperAdmin,
} from "@/utils/dashboard-auth";
import AdministrationShell from "./administration-shell";

export default async function AdministrationLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await getCurrentUserRole();
  const showPlatformMonitoringTabs = await isDavorsPlatformSuperAdmin();

  if (role !== "super_admin") {
    redirect("/dashboard");
  }

  return (
    <AdministrationShell showPlatformMonitoringTabs={showPlatformMonitoringTabs}>
      {children}
    </AdministrationShell>
  );
}
