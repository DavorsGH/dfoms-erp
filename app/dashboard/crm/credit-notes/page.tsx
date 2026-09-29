import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canRecordCreditNoteRefund } from "@/utils/rbac-access";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import CrmShell from "../crm-shell";
import CreditNotes from "../../finance/credit-notes/credit-notes";
import { loadCreditNotesPageData } from "../../finance/credit-notes/load-credit-notes-page-data";

export default async function CrmCreditNotesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();
  const [activeBusinessUnitId, viewAllBusinessUnits, role] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
    getCurrentUserRole(),
  ]);

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { rows, paymentMethods, fetchError } = await loadCreditNotesPageData(
    supabase,
    tenantId,
    buScope,
  );

  return (
    <CrmShell sectionTitle="Credit Notes">
      <CreditNotes
        initialRows={rows}
        paymentMethods={paymentMethods}
        fetchError={fetchError}
        allowRecordRefund={canRecordCreditNoteRefund(role as AppRole | null)}
      />
    </CrmShell>
  );
}
