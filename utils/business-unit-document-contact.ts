import type { SupabaseClient } from "@supabase/supabase-js";

export type BusinessUnitDocumentContact = {
  id: string;
  name: string;
  invoice_address: string | null;
  business_email: string | null;
};

/**
 * Load invoice address + business email for a stamped business unit.
 * Returns null when no BU id or the row is missing.
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
    .select("id, name, invoice_address, business_email")
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

  return {
    id: data.id as string,
    name: (data.name as string)?.trim() || "",
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
