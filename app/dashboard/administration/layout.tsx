import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getCurrentUserRole,
  isDavorsPlatformSuperAdmin,
} from "@/utils/dashboard-auth";
import {
  LOGIN_ACTIVITY_ADMIN_HREF,
} from "./administration-nav-config";
import AdministrationShell from "./administration-shell";

export default async function AdministrationLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await getCurrentUserRole();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const showPlatformMonitoringTabs = await isDavorsPlatformSuperAdmin();

  if (role !== "super_admin" && role !== "director") {
    redirect("/dashboard");
  }

  if (role === "director" && pathname !== LOGIN_ACTIVITY_ADMIN_HREF) {
    redirect("/dashboard");
  }

  return (
    <AdministrationShell showPlatformMonitoringTabs={showPlatformMonitoringTabs}>
      {children}
    </AdministrationShell>
  );
}
