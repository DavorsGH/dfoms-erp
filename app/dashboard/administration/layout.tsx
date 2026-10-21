import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { isDirectorAdministrationPath } from "./administration-access";
import AdministrationShell from "./administration-shell";

export const metadata: Metadata = {
  title: "Administration",
};

export default async function AdministrationLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await getCurrentUserRole();

  if (role !== "super_admin" && role !== "director") {
    redirect("/dashboard");
  }

  if (role === "director") {
    const pathname = (await headers()).get("x-pathname")?.trim() ?? "";
    // Document requests carry x-pathname. A known path outside the allow-list
    // is rejected. An empty path is an RSC fetch: nested super_admin layouts
    // still block every other Administration route.
    if (pathname && !isDirectorAdministrationPath(pathname)) {
      redirect("/dashboard");
    }
  }

  return <AdministrationShell>{children}</AdministrationShell>;
}
