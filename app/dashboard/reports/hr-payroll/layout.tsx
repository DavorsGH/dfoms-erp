import ReportsCategoryLayout from "../reports-category-layout";

export default function HrPayrollReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReportsCategoryLayout
      categoryId="hr-payroll"
      pageTitle="HR & Payroll Reports"
    >
      {children}
    </ReportsCategoryLayout>
  );
}
