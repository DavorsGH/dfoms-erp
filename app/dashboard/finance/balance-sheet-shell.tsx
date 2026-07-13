import FinanceNav from "./finance-nav";
import BalanceSheetNav from "./balance-sheet-nav";

type BalanceSheetShellProps = {
  children: React.ReactNode;
  sectionTitle?: string;
};

export default function BalanceSheetShell({
  children,
  sectionTitle,
}: BalanceSheetShellProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Balance Sheet</h2>
      <BalanceSheetNav />
      {sectionTitle ? (
        <h3 className="mb-6 text-lg font-semibold text-[#0f2744]">
          {sectionTitle}
        </h3>
      ) : null}
      {children}
    </div>
  );
}
