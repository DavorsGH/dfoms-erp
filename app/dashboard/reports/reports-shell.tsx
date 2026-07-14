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
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
