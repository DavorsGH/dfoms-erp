import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { isDavorsPlatformTenant } from "@/utils/tenant-signup";
import CrmNav from "./crm-nav";

type CrmShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
  customerListOnly?: boolean;
};

export default async function CrmShell({
  children,
  sectionTitle,
  customerListOnly = false,
}: CrmShellProps) {
  const tenantId = await getCurrentUserTenantId();

  if (customerListOnly) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Customer List</h1>
        {children}
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Sales & CRM</h1>
      <CrmNav showProductCatalog={isDavorsPlatformTenant(tenantId)} />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
