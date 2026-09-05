import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";
import type { BusinessUnitDocumentContact } from "@/utils/business-unit-document-contact-types";

export type { BusinessUnitDocumentContact } from "@/utils/business-unit-document-contact-types";
export { businessUnitDocumentContactFromSwitcher } from "@/utils/business-unit-document-contact-types";

/**
 * Load document branding contact fields for a stamped business unit.
 * Returns null when no BU id or the row is missing.
 * Name/logo/address/email: callers fall back to tenant when BU fields are empty.
 */
export async function loadBusinessUnitDocumentContact(
  supabase: SupabaseClient,
  tenantId: string,
  businessUnitId: string | null | undefined,
): Promise<BusinessUnitDocumentContact | null> {
  const id = businessUnitId?.trim() || null;
  if (!id) {
    return null;
  }

  const { data, error } = await supabase
    .from("business_units")
    .select("id, name, logo_url, invoice_address, business_email")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(
      "[business-unit-document-contact] load failed:",
      error.message,
    );
    return null;
  }

  if (!data) {
    return null;
  }

  const logo_url = (data.logo_url as string | null)?.trim() || null;
  let logoUrl: string | null = null;
  if (logo_url) {
    try {
      const admin = createAdminClient();
      logoUrl =
        (await createTenantLogosSignedUrl(admin, logo_url)) ?? logo_url;
    } catch (signError) {
      console.error(
        "[business-unit-document-contact] logo sign failed:",
        signError instanceof Error ? signError.message : signError,
      );
      logoUrl = logo_url;
    }
  }

  return {
    id: data.id as string,
    name: (data.name as string)?.trim() || "",
    logo_url,
    logoUrl,
    invoice_address: (data.invoice_address as string | null)?.trim() || null,
    business_email: (data.business_email as string | null)?.trim() || null,
  };
}

/** Look up only business_email for Reply-To (null → keep default sender behavior). */
export async function loadBusinessUnitReplyToEmail(
  supabase: SupabaseClient,
  tenantId: string,
  businessUnitId: string | null | undefined,
): Promise<string | null> {
  const contact = await loadBusinessUnitDocumentContact(
    supabase,
    tenantId,
    businessUnitId,
  );
  return contact?.business_email?.trim() || null;
}
