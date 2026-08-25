import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserClientId } from "@/utils/dashboard-auth";
import {
  SERVICE_INCOME_REGISTER_SELECT,
  type IncomeRegisterEntry,
} from "../../finance/income-register-utils";
import ClientPortalShell from "../client-portal-shell";
import MyInvoices from "../my-invoices";

/**
 * Portal list reads income_register; View links need client_invoice_id.
 * Legacy rows may lack that FK — resolve via invoice_no for this client's
 * non-draft invoices so Pending/Overdue/Partial/Paid (and Voided) all link.
 */
async function resolveClientInvoiceIdsForPortal(
  entries: IncomeRegisterEntry[],
  clientId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<IncomeRegisterEntry[]> {
  const missingNos = [
    ...new Set(
      entries
        .filter((entry) => !entry.client_invoice_id?.trim() && entry.invoice_no?.trim())
        .map((entry) => entry.invoice_no.trim()),
    ),
  ];

  if (missingNos.length === 0) {
    return entries;
  }

  const { data: invoices } = await supabase
    .from("client_invoices")
    .select("id, invoice_number, status")
    .eq("client_id", clientId)
    .in("invoice_number", missingNos)
    .neq("status", "draft");

  const idByNumber = new Map<string, string>();
  for (const invoice of invoices ?? []) {
    if (invoice.invoice_number && invoice.id) {
      idByNumber.set(invoice.invoice_number, invoice.id);
    }
  }

  if (idByNumber.size === 0) {
    return entries;
  }

  return entries.map((entry) => {
    if (entry.client_invoice_id?.trim() || !entry.invoice_no?.trim()) {
      return entry;
    }
    const resolvedId = idByNumber.get(entry.invoice_no.trim());
    if (!resolvedId) {
      return entry;
    }
    return { ...entry, client_invoice_id: resolvedId };
  });
}

export default async function ClientPortalInvoicesPage() {
  const clientId = await getCurrentUserClientId();

  if (!clientId) {
    return (
      <ClientPortalShell sectionTitle="My Invoices">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to a customer record.
        </div>
      </ClientPortalShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Include Voided rows so clients can open them (detail shows a voided banner).
  // Draft client invoices never sync to income_register.
  const { data, error } = await supabase
    .from("income_register")
    .select(SERVICE_INCOME_REGISTER_SELECT)
    .eq("entry_type", "service")
    .order("date", { ascending: false });

  const resolvedEntries = error
    ? []
    : await resolveClientInvoiceIdsForPortal(
        (data as IncomeRegisterEntry[] | null) ?? [],
        clientId,
        supabase,
      );

  const { data: receiptRows } = await supabase
    .from("client_receipts")
    .select("id, receipt_number, invoice_id")
    .order("receipt_date", { ascending: false });

  const receiptsByInvoiceId: Record<
    string,
    Array<{ id: string; receipt_number: string }>
  > = {};

  for (const receipt of receiptRows ?? []) {
    const list = receiptsByInvoiceId[receipt.invoice_id] ?? [];
    list.push({ id: receipt.id, receipt_number: receipt.receipt_number });
    receiptsByInvoiceId[receipt.invoice_id] = list;
  }

  return (
    <ClientPortalShell sectionTitle="My Invoices">
      <MyInvoices
        initialEntries={resolvedEntries}
        receiptsByInvoiceId={receiptsByInvoiceId}
        fetchError={error?.message ?? null}
      />
    </ClientPortalShell>
  );
}
