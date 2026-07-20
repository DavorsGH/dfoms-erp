import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  DEFAULT_TENANT_BRANDING,
  DEFAULT_COMPANY_LEGAL_NAME,
  DEFAULT_WORKSPACE_LOGO,
  DEFAULT_WORKSPACE_NAME,
  type TenantBranding,
} from "@/utils/tenant-branding-types";

export type { TenantBranding } from "@/utils/tenant-branding-types";
export {
  DEFAULT_COMPANY_LEGAL_NAME,
  DEFAULT_TENANT_BRANDING,
  DEFAULT_WORKSPACE_LOGO,
  DEFAULT_WORKSPACE_NAME,
  DAVORS_PLATFORM_LOGO,
} from "@/utils/tenant-branding-types";

export const getCurrentTenantBranding = cache(
  async (): Promise<TenantBranding> => {
    const tenantId = await getCurrentUserTenantId();
    if (!tenantId) {
      return DEFAULT_TENANT_BRANDING;
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data, error } = await supabase
      .from("tenants")
      .select("name, logo_url, address, phone, email")
      .eq("id", tenantId)
      .maybeSingle();

    if (error || !data) {
      return DEFAULT_TENANT_BRANDING;
    }

    return {
      workspaceName: data.name?.trim() || DEFAULT_WORKSPACE_NAME,
      workspaceLogoUrl: data.logo_url?.trim() || DEFAULT_WORKSPACE_LOGO,
      companyLegalName: data.name?.trim() || DEFAULT_COMPANY_LEGAL_NAME,
      address: data.address?.trim() || null,
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
    };
  },
);
