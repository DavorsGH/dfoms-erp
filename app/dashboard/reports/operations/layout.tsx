import ReportsCategoryLayout from "../reports-category-layout";

export default function OperationsReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReportsCategoryLayout categoryId="operations" pageTitle="Operations Reports">
      {children}
    </ReportsCategoryLayout>
  );
}
