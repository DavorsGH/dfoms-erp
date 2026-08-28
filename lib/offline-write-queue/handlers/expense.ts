import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveManualExpenseReceiptNo } from "@/app/dashboard/finance/expense-register-api";
import { syncPurchaseTaxLedger } from "@/app/dashboard/finance/tax-ledger-sync";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import type { ExpenseQueuePayload } from "@/lib/offline-write-queue/types";

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("client_op_id")
  );
}

/**
 * Replay online expense create sequence: insert → tax ledger → admin notification.
 * Idempotency via expense_register.client_op_id (= queue UUID) and stable row id.
 */
export async function syncExpenseQueueItem(
  supabase: SupabaseClient,
  input: {
    clientOpId: string;
    tenantId: string;
    payload: ExpenseQueuePayload;
    notificationSent: boolean;
  },
): Promise<
  | { ok: true; notificationSent: boolean; expenseId: string }
  | { ok: false; error: string }
> {
  const payload = input.payload;

  let expenseId: string | null = null;

  const existing = await supabase
    .from("expense_register")
    .select("id, receipt_no")
    .eq("client_op_id", input.clientOpId)
    .maybeSingle();

  if (existing.error) {
    return { ok: false, error: existing.error.message };
  }

  if (existing.data?.id) {
    expenseId = existing.data.id;
  } else {
    const resolved = await resolveManualExpenseReceiptNo(
      supabase,
      payload.supplied_receipt_no,
    );
    if (resolved.error || !resolved.receiptNo) {
      return {
        ok: false,
        error: resolved.error ?? "Unable to allocate receipt number.",
      };
    }

    const insertRow = {
      id: input.clientOpId,
      client_op_id: input.clientOpId,
      tenant_id: input.tenantId,
      date: payload.date,
      expense_category: payload.expense_category,
      sub_category: payload.sub_category,
      description: payload.description,
      vendor: payload.vendor,
      price: payload.price,
      quantity: payload.quantity,
      amount: payload.amount,
      payment_method: payload.payment_method,
      approved_by: payload.approved_by,
      receipt_no: resolved.receiptNo,
      payment_status: payload.payment_status,
      gross_before_wht: payload.gross_before_wht,
      wht_rate: payload.wht_rate,
      wht_amount: payload.wht_amount,
      input_vat_amount: payload.input_vat_amount,
      net_of_tax_amount: payload.net_of_tax_amount,
      notes: payload.notes,
      project_id: payload.project_id ?? null,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("expense_register")
      .insert(insertRow)
      .select("id")
      .single();

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        const again = await supabase
          .from("expense_register")
          .select("id")
          .eq("client_op_id", input.clientOpId)
          .maybeSingle();
        if (again.data?.id) {
          expenseId = again.data.id;
        } else {
          return { ok: false, error: insertError.message };
        }
      } else {
        return { ok: false, error: insertError.message };
      }
    } else {
      expenseId = (inserted as { id: string }).id;
    }
  }

  if (!expenseId) {
    return { ok: false, error: "Expense sync did not resolve a row id." };
  }

  let receiptNote: string | null = payload.supplied_receipt_no
    ? `Receipt ${payload.supplied_receipt_no}`
    : null;

  if (existing.data?.receipt_no) {
    receiptNote = `Receipt ${existing.data.receipt_no}`;
  } else if (expenseId) {
    const { data: row } = await supabase
      .from("expense_register")
      .select("receipt_no")
      .eq("id", expenseId)
      .maybeSingle();
    if (row?.receipt_no) {
      receiptNote = `Receipt ${row.receipt_no}`;
    }
  }

  const { error: ledgerError } = await syncPurchaseTaxLedger(supabase, {
    sourceType: "expense_register",
    sourceId: expenseId,
    entryDate: payload.date,
    grossBeforeWht: payload.gross_before_wht,
    whtRatePct: payload.wht_rate_pct,
    whtAmount: payload.wht_amount,
    inputTaxComponent: payload.input_tax_component,
    inputTaxRatePct: null,
    inputVatAmount: payload.input_vat_amount,
    counterpartyName: payload.vendor || null,
    notes: receiptNote,
  });

  if (ledgerError) {
    return { ok: false, error: `Tax ledger sync failed: ${ledgerError}` };
  }

  let notificationSent = input.notificationSent;
  if (!notificationSent) {
    requestTenantAdminDirectorNotification({
      title: "New expense recorded",
      detail: payload.notification_detail,
      actionUrl: "/dashboard/finance/expenses",
    });
    notificationSent = true;
  }

  return { ok: true, notificationSent, expenseId };
}
