import { redirect } from "next/navigation";
import { isDavorsPlatformRealEstateStaff } from "@/utils/dashboard-auth";
import ReportsCategoryLayout from "../reports-category-layout";

export default async function RealEstateReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Same gate as `/dashboard/real-estate` staff ops.
  if (!(await isDavorsPlatformRealEstateStaff())) {
    redirect("/dashboard");
  }

  return (
    <ReportsCategoryLayout
      categoryId="real-estate"
      pageTitle="Real Estate Reports"
    >
      {children}
    </ReportsCategoryLayout>
  );
}
