import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserClientId } from "@/utils/dashboard-auth";
import {
  CLIENT_RECEIPT_LIST_SELECT,
  type ClientReceiptListRow,
} from "@/utils/client-receipts-types";
import ClientPortalShell from "../client-portal-shell";
import MyReceipts from "../my-receipts";

export default async function ClientPortalReceiptsPage() {
  const clientId = await getCurrentUserClientId();

  if (!clientId) {
    return (
      <ClientPortalShell sectionTitle="Receipts">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to a customer record.
        </div>
      </ClientPortalShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("client_receipts")
    .select(CLIENT_RECEIPT_LIST_SELECT)
    .order("receipt_date", { ascending: false });

  return (
    <ClientPortalShell sectionTitle="Receipts">
      <MyReceipts
        initialReceipts={(data as ClientReceiptListRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </ClientPortalShell>
  );
}
