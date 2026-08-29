import type { SupabaseClient } from "@supabase/supabase-js";
import { syncProductSaleVfrsTax } from "@/utils/product-sale-tax-sync";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import type { PosCashSaleQueuePayload } from "@/lib/offline-write-queue/types";

export type SyncPosCashSaleResult =
  | {
      ok: true;
      outcome: "synced";
      invoiceNo: string;
      incomeIds: string[];
      taxSyncWarning?: string | null;
    }
  | {
      ok: true;
      outcome: "conflict";
      conflictId: string;
      suspenseInvoiceNo: string;
      suspenseIncomeId: string;
    }
  | { ok: false; error: string };

/**
 * Drain handler: whole-cart offline cash POS sync via sync_offline_pos_cash_sale.
 * Clean → POS invoice + VFRS. Conflict → OSC suspense (server already booked) + notify.
 */
export async function syncPosCashSaleQueueItem(
  supabase: SupabaseClient,
  input: {
    clientOpId: string;
    tenantId: string;
    payload: PosCashSaleQueuePayload;
    notificationSent: boolean;
  },
): Promise<SyncPosCashSaleResult & { notificationSent?: boolean }> {
  const { data, error } = await supabase.rpc("sync_offline_pos_cash_sale", {
    p_client_op_id: input.clientOpId,
    p_payload: {
      sale_date: input.payload.saleDate,
      client_id: input.payload.clientId,
      customer_name: input.payload.customerName,
      payment_method: input.payload.paymentMethod,
      amount_received: input.payload.amountReceived,
      notes: input.payload.notes,
      provisional_token: input.payload.provisionalToken,
      sales_rep_id: input.payload.salesRepId,
      lines: input.payload.lines.map((line) => ({
        product_id: line.productId,
        product_code: line.productCode,
        product_name: line.productName,
        quantity: line.quantity,
        unit_price: line.unitPrice,
      })),
    },
    p_business_unit_id: input.payload.business_unit_id ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const result = data as {
    status?: string;
    invoice_no?: string;
    income_ids?: string[];
    conflict_id?: string;
    suspense_invoice_no?: string;
    suspense_income_id?: string;
    error?: string;
  } | null;

  if (!result || result.error) {
    return {
      ok: false,
      error: result?.error ?? "Offline POS sync returned an empty result.",
    };
  }

  if (result.status === "synced") {
    const incomeIds = (result.income_ids ?? []).filter(Boolean);
    let taxSyncWarning: string | null = null;
    if (incomeIds.length > 0) {
      const tax = await syncProductSaleVfrsTax(supabase, incomeIds);
      taxSyncWarning = tax.error;
    }
    return {
      ok: true,
      outcome: "synced",
      invoiceNo: String(result.invoice_no ?? ""),
      incomeIds,
      taxSyncWarning,
      notificationSent: input.notificationSent,
    };
  }

  if (result.status === "conflict") {
    let notificationSent = input.notificationSent;
    if (!notificationSent) {
      requestTenantAdminDirectorNotification({
        title: "Offline POS sale needs review",
        detail: `Suspense ${result.suspense_invoice_no ?? "OSC"} — stock shortfall on sync (${input.payload.provisionalToken})`,
        actionUrl: "/dashboard/crm/offline-sale-conflicts",
        bodyFormat: "plain",
      });
      notificationSent = true;
    }
    return {
      ok: true,
      outcome: "conflict",
      conflictId: String(result.conflict_id ?? ""),
      suspenseInvoiceNo: String(result.suspense_invoice_no ?? ""),
      suspenseIncomeId: String(result.suspense_income_id ?? ""),
      notificationSent,
    };
  }

  return {
    ok: false,
    error: `Unexpected offline POS sync status: ${String(result.status)}`,
  };
}
