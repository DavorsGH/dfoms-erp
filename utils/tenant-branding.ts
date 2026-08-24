import "server-only";

import { cache } from "react";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";
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

    return getTenantBrandingById(tenantId);
  },
);

export async function getTenantBrandingById(
  tenantId: string,
): Promise<TenantBranding> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tenants")
    .select(
      "name, logo_url, signature_url, signature_author_name, signature_author_title, address, phone, email",
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) {
    return DEFAULT_TENANT_BRANDING;
  }

  const rawLogoUrl = data.logo_url?.trim() || "";
  let workspaceLogoUrl = DEFAULT_WORKSPACE_LOGO;
  const workspaceLogoReference = rawLogoUrl || DEFAULT_WORKSPACE_LOGO;
  if (rawLogoUrl) {
    workspaceLogoUrl =
      (await createTenantLogosSignedUrl(admin, rawLogoUrl)) ?? rawLogoUrl;
  }

  const rawSignatureUrl = data.signature_url?.trim() || "";
  let signatureImageUrl: string | null = null;
  if (rawSignatureUrl) {
    signatureImageUrl =
      (await createTenantLogosSignedUrl(admin, rawSignatureUrl)) ??
      rawSignatureUrl;
  }

  return {
    workspaceName: data.name?.trim() || DEFAULT_WORKSPACE_NAME,
    workspaceLogoUrl,
    workspaceLogoReference,
    companyLegalName: data.name?.trim() || DEFAULT_COMPANY_LEGAL_NAME,
    address: data.address?.trim() || null,
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    signatureImageUrl,
    signatureAuthorName: data.signature_author_name?.trim() || null,
    signatureAuthorTitle: data.signature_author_title?.trim() || null,
  };
}
