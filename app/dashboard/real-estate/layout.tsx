import { redirect } from "next/navigation";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";

export default async function RealEstateLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
