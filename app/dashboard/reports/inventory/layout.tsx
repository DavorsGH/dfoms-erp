import ReportsCategoryLayout from "../reports-category-layout";

export default function InventoryReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReportsCategoryLayout
      categoryId="inventory"
      pageTitle="Inventory Reports"
      featureKey="inventory"
    >
      {children}
    </ReportsCategoryLayout>
  );
}
