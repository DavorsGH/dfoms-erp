import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessUnitDocumentContact } from "@/utils/business-unit-document-contact-types";
import type { TenantBranding } from "@/utils/tenant-branding-types";
import { resolvePdfAssetUrl } from "@/utils/pdf-asset-url";
import { resolvePdfImageDataUrl } from "@/utils/pdf-image-source";
import { createAdminClient } from "@/utils/supabase/admin";

export type PdfBrandingImages = {
  logoUrl: string;
  signatureImageUrl: string | null;
};

export async function resolvePdfBrandingImages(options: {
  supabase: SupabaseClient;
  tenantId: string;
  branding: TenantBranding;
  businessUnitContact?: BusinessUnitDocumentContact | null;
  siteBaseUrl?: string | null;
}): Promise<PdfBrandingImages> {
  const admin = createAdminClient();
  const siteBaseUrl =
    options.siteBaseUrl?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    null;

  const { data: tenantMediaRow, error: tenantMediaError } = await options.supabase
    .from("tenants")
    .select("logo_url, signature_url")
    .eq("id", options.tenantId)
    .maybeSingle();

  if (tenantMediaError) {
    console.error(
      "[pdf-branding-images] tenant media lookup failed:",
      tenantMediaError.message,
    );
  }

  const buLogoReference =
    options.businessUnitContact?.logo_url?.trim() ||
    options.businessUnitContact?.logoUrl?.trim() ||
    "";
  const tenantLogoReference =
    tenantMediaRow?.logo_url?.trim() || options.branding.workspaceLogoUrl;
  const logoReference = buLogoReference || tenantLogoReference;
  const signatureReference = tenantMediaRow?.signature_url?.trim() || null;
  const headerBrandingSignature =
    options.branding.signatureImageUrl?.trim() || null;

  const [logoDataUrl, signatureImageUrl] = await Promise.all([
    resolvePdfImageDataUrl({
      admin,
      reference: logoReference,
      siteBaseUrl,
    }),
    signatureReference
      ? resolvePdfImageDataUrl({
          admin,
          reference: signatureReference,
          siteBaseUrl,
        })
      : headerBrandingSignature
        ? resolvePdfImageDataUrl({
            admin,
            reference: headerBrandingSignature,
            siteBaseUrl,
          })
        : Promise.resolve(null),
  ]);

  return {
    logoUrl:
      logoDataUrl ?? resolvePdfAssetUrl(logoReference, siteBaseUrl) ?? "",
    signatureImageUrl,
  };
}
