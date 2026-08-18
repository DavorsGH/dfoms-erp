import AdministrationNav from "./administration-nav";

type AdministrationShellProps = {
  children: React.ReactNode;
};

export default function AdministrationShell({
  children,
}: AdministrationShellProps) {
  return (
    <div className="min-w-0">
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Administration
      </h1>
      <AdministrationNav />
      {children}
    </div>
  );
}
