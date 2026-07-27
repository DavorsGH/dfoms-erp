import ReportsCategoryLayout from "../reports-category-layout";

export default function SalesReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReportsCategoryLayout
      categoryId="sales"
      pageTitle="Sales Reports"
      featureKey="crm_core"
    >
      {children}
    </ReportsCategoryLayout>
  );
}
