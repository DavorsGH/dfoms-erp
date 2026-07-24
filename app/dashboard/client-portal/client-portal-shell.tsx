import ClientPortalNav from "./client-portal-nav";

type ClientPortalShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function ClientPortalShell({
  children,
  sectionTitle,
}: ClientPortalShellProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Customer Portal
      </h1>
      <ClientPortalNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        {sectionTitle}
      </h2>
      {children}
    </div>
  );
}
