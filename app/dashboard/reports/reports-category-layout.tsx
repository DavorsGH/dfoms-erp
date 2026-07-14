import ReportsCategoryNav from "./reports-category-nav";

type ReportsCategoryLayoutProps = {
  categoryId: string;
  pageTitle: string;
  children: React.ReactNode;
};

export default function ReportsCategoryLayout({
  categoryId,
  pageTitle,
  children,
}: ReportsCategoryLayoutProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">{pageTitle}</h1>
      <ReportsCategoryNav categoryId={categoryId} />
      {children}
    </div>
  );
}
