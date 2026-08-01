import PortalNav from "./portal-nav";
import PortalSignOutButton from "./dashboard/sign-out-button";

type PortalShellProps = {
  fullName: string;
  children: React.ReactNode;
};

export default function PortalShell({ fullName, children }: PortalShellProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Davors Tenant Portal
            </p>
            <h1 className="text-lg font-semibold text-[#0f2744]">
              Welcome, {fullName}
            </h1>
          </div>
          <PortalSignOutButton />
        </div>
      </header>
      <PortalNav />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
