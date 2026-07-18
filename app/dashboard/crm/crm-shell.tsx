import CrmNav from "./crm-nav";

type CrmShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function CrmShell({ children, sectionTitle }: CrmShellProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">CRM</h1>
      <CrmNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
