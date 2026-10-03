import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Real Estate",
};
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
