import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  CLIENT_RECEIPT_LIST_SELECT,
  type ClientReceiptListRow,
} from "@/utils/client-receipts-types";
import FinanceNav from "../finance-nav";
import ClientReceiptsList from "./client-receipts-list";

export default async function ClientReceiptsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <FinanceNav />
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("client_receipts")
    .select(CLIENT_RECEIPT_LIST_SELECT)
    .eq("tenant_id", tenantId)
    .order("receipt_date", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Customer Receipts</h2>
      <ClientReceiptsList
        initialReceipts={(data as ClientReceiptListRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
