import OperationsNav from "./operations-nav";

type OperationsShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function OperationsShell({
  children,
  sectionTitle,
}: OperationsShellProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Operations</h1>
      <OperationsNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
