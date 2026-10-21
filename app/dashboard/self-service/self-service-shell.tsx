import SelfServiceNav from "./self-service-nav";

type SelfServiceShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
  hideSectionTitle?: boolean;
};

export default function SelfServiceShell({
  children,
  sectionTitle,
  hideSectionTitle = false,
}: SelfServiceShellProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Self-Service</h1>
      <SelfServiceNav />
      {hideSectionTitle ? null : (
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      )}
      {children}
    </div>
  );
}
