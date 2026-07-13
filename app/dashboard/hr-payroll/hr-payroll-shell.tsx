import HrPayrollNav from "./hr-payroll-nav";

type HrPayrollShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function HrPayrollShell({
  children,
  sectionTitle,
}: HrPayrollShellProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">HR &amp; Payroll</h1>
      <HrPayrollNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
