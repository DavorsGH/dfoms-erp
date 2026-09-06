import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
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
  const [tenantId, role] = await Promise.all([
    getCurrentUserTenantId(),
    getCurrentUserRole(),
  ]);
  const userRole = (role as AppRole | null) ?? null;

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
      <CrmNav
        showProductCatalog={isDavorsPlatformTenant(tenantId)}
        userRole={userRole}
      />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
