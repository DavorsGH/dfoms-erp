import { formatCreditNoteOutcomeLabel } from "../crm/sales/sales-register-return-display";

export type CreditNoteListRow = {
  id: string;
  credit_note_number: string;
  credit_note_date: string;
  business_unit_id: string | null;
  client_id: string | null;
  pos_invoice_no: string | null;
  total_amount: number;
  refunded_amount: number;
  applied_amount: number;
  return_mode: string | null;
  status: string | null;
  customer?: { client_name: string } | { client_name: string }[] | null;
};

export const CREDIT_NOTES_LIST_SELECT =
  "id, credit_note_number, credit_note_date, business_unit_id, client_id, pos_invoice_no, total_amount, refunded_amount, applied_amount, return_mode, status, customer:customers!credit_notes_client_fkey(client_name)";

export function creditNoteAvailableBalance(row: {
  total_amount: number;
  refunded_amount: number;
  applied_amount: number;
}): number {
  const total = Number(row.total_amount) || 0;
  const refunded = Number(row.refunded_amount) || 0;
  const applied = Number(row.applied_amount) || 0;
  return Math.max(0, Math.round((total - refunded - applied) * 100) / 100);
}

export function formatCreditNoteCustomerLabel(row: CreditNoteListRow): string {
  const customer = Array.isArray(row.customer)
    ? row.customer[0]
    : row.customer;
  if (customer?.client_name?.trim()) {
    return customer.client_name.trim();
  }
  if (!row.client_id?.trim()) {
    return "Walk-in";
  }
  return row.client_id;
}

export function formatCreditNoteOutcome(row: CreditNoteListRow): string {
  return formatCreditNoteOutcomeLabel(row.return_mode);
}

export function computeCustomerStoreCreditBalance(
  notes: Array<{
    return_mode: string | null;
    total_amount: number;
    refunded_amount: number;
    applied_amount: number;
  }>,
): number {
  return notes.reduce((sum, note) => {
    const mode = note.return_mode?.trim().toLowerCase() ?? "";
    if (mode !== "store_credit" && mode !== "exchange_hold") {
      return sum;
    }
    return sum + creditNoteAvailableBalance(note);
  }, 0);
}
