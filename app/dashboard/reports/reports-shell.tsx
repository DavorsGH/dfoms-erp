import ReportsFinanceNav from "./reports-finance-nav";
import ReportsHrNav from "./reports-hr-nav";

type ReportsShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function ReportsShell({
  children,
  sectionTitle,
}: ReportsShellProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Reports</h1>
      <ReportsFinanceNav />
      <ReportsHrNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
