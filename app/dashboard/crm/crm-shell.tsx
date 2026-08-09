import Link from "next/link";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { isDavorsPlatformTenant } from "@/utils/tenant-signup";
import CrmNav from "./crm-nav";

const sectionActionLinkClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

type CrmShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default async function CrmShell({ children, sectionTitle }: CrmShellProps) {
  const tenantId = await getCurrentUserTenantId();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#0f2744]">Sales & CRM</h1>
        <Link
          href="/dashboard/bulk-import?type=service"
          className={sectionActionLinkClassName}
        >
          Bulk Import Services
        </Link>
      </div>
      <CrmNav showProductCatalog={isDavorsPlatformTenant(tenantId)} />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
