import ReportsCategoryLayout from "../reports-category-layout";

export default function FinanceReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReportsCategoryLayout categoryId="finance" pageTitle="Finance Reports">
      {children}
    </ReportsCategoryLayout>
  );
}
