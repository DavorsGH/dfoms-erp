import ReportsCategoryLayout from "../reports-category-layout";

export default function ClientReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReportsCategoryLayout
      categoryId="client-facing"
      pageTitle="Customer-Facing Reports"
    >
      {children}
    </ReportsCategoryLayout>
  );
}
