import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/utils/dashboard-auth";
import AdministrationShell from "./administration-shell";

export default async function AdministrationLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!(await isSuperAdmin())) {
    redirect("/dashboard");
  }

  return <AdministrationShell>{children}</AdministrationShell>;
}
