import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/utils/dashboard-auth";
import AdministrationNav from "./administration-nav";

export default async function AdministrationLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!(await isSuperAdmin())) {
    redirect("/dashboard");
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Administration
      </h1>
      <AdministrationNav />
      {children}
    </div>
  );
}
