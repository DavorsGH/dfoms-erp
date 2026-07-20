export const DEFAULT_WORKSPACE_NAME = "Davors Facilities";
export const DEFAULT_WORKSPACE_LOGO = "/logo.jpg";
export const DEFAULT_COMPANY_LEGAL_NAME =
  "Davors Facilities Management Services Ltd";
export const DAVORS_PLATFORM_LOGO = "/icons/apple-touch-icon-180x180.png";

export type TenantBranding = {
  workspaceName: string;
  workspaceLogoUrl: string;
  companyLegalName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
};

export const DEFAULT_TENANT_BRANDING: TenantBranding = {
  workspaceName: DEFAULT_WORKSPACE_NAME,
  workspaceLogoUrl: DEFAULT_WORKSPACE_LOGO,
  companyLegalName: DEFAULT_COMPANY_LEGAL_NAME,
  address: null,
  phone: null,
  email: null,
};
