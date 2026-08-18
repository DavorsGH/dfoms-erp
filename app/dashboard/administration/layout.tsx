import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import AdministrationShell from "./administration-shell";

export default async function AdministrationLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await getCurrentUserRole();

  if (role !== "super_admin") {
    redirect("/dashboard");
  }

  return <AdministrationShell>{children}</AdministrationShell>;
}
