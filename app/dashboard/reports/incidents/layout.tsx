import ReportsCategoryLayout from "../reports-category-layout";

export default function IncidentsReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReportsCategoryLayout categoryId="incidents" pageTitle="Incidents Reports">
      {children}
    </ReportsCategoryLayout>
  );
}
