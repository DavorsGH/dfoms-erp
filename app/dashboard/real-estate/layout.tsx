import { redirect } from "next/navigation";
import { isDavorsPlatformRealEstateStaff } from "@/utils/dashboard-auth";

export default async function RealEstateLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!(await isDavorsPlatformRealEstateStaff())) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
