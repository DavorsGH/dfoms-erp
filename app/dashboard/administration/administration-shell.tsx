import AdministrationNav from "./administration-nav";

type AdministrationShellProps = {
  children: React.ReactNode;
  showPlatformMonitoringTabs?: boolean;
};

export default function AdministrationShell({
  children,
  showPlatformMonitoringTabs = false,
}: AdministrationShellProps) {
  return (
    <div className="min-w-0">
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Administration
      </h1>
      <AdministrationNav
        showPlatformMonitoringTabs={showPlatformMonitoringTabs}
      />
      {children}
    </div>
  );
}
