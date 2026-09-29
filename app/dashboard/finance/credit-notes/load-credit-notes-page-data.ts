import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  CREDIT_NOTES_LIST_SELECT,
  type CreditNoteListRow,
} from "../credit-notes-utils";

export const CREDIT_NOTES_PAGE_PATH = "/dashboard/crm/credit-notes";

export async function loadCreditNotesPageData(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<{
  rows: CreditNoteListRow[];
  paymentMethods: string[];
  fetchError: string | null;
}> {
  const [{ data: rows, error }, { data: paymentMethods }] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("credit_notes")
        .select(CREDIT_NOTES_LIST_SELECT)
        .eq("tenant_id", tenantId)
        .order("credit_note_date", { ascending: false }),
      buScope,
    ),
    supabase
      .from("payment_methods")
      .select("name")
      .eq("tenant_id", tenantId)
      .order("name"),
  ]);

  const methods =
    (paymentMethods ?? [])
      .map((row) => String(row.name ?? "").trim())
      .filter(Boolean) || ["Cash"];

  return {
    rows: (rows as CreditNoteListRow[] | null) ?? [],
    paymentMethods: methods.length > 0 ? methods : ["Cash"],
    fetchError: error?.message ?? null,
  };
}
