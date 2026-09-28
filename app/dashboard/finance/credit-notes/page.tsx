import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import FinanceNav from "../finance-nav";
import CreditNotes from "./credit-notes";
import { CREDIT_NOTES_LIST_SELECT, type CreditNoteListRow } from "../credit-notes-utils";

export default async function CreditNotesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

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

  return (
    <div className="min-w-0 p-6">
      <FinanceNav />
      <h1 className="mb-4 text-2xl font-semibold text-[#0f2744]">Credit Notes</h1>
      <CreditNotes
        initialRows={(rows as CreditNoteListRow[] | null) ?? []}
        paymentMethods={methods.length > 0 ? methods : ["Cash"]}
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
