import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserClientId } from "@/utils/dashboard-auth";
import {
  SERVICE_INCOME_REGISTER_SELECT,
  type IncomeRegisterEntry,
} from "../../finance/income-register-utils";
import ClientPortalShell from "../client-portal-shell";
import MyInvoices from "../my-invoices";

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

  const { data, error } = await supabase
    .from("income_register")
    .select(SERVICE_INCOME_REGISTER_SELECT)
    .eq("entry_type", "service")
    .order("date", { ascending: false });

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
        initialEntries={(data as IncomeRegisterEntry[] | null) ?? []}
        receiptsByInvoiceId={receiptsByInvoiceId}
        fetchError={error?.message ?? null}
      />
    </ClientPortalShell>
  );
}
